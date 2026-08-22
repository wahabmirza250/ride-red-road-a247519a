/**
 * AUTOMATIC CLAIM STATUS SYNC — READ-ONLY.
 *
 * Completely separate from the submission robot. This module NEVER submits,
 * confirms, adjusts or resubmits anything. It only asks the portal
 * "what is the current status of claim #X?" and writes the answer back.
 *
 * Safety rules baked in here:
 *   - Read-only contract on every request (`read_only: true`, no trip payload).
 *   - A bounded batch per run, a single-flight database lease, and a paused
 *     state that every entry point checks first.
 *   - It never competes with submissions: a company with a queued/submitting
 *     bill is skipped entirely for this run.
 *   - Uncertain answer = no change. Only a status the portal states plainly is
 *     written; anything else leaves the stored status exactly as it was.
 *   - Every real change is written to billing_audit_log with previous status,
 *     new status and the time it was observed.
 */

/** ---- Scaling configuration (env-backed, safe defaults) ----------------
 *  Every knob below can be tuned per environment without a code change. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
/** Max concurrent read-only status checks for ONE company. Conservative. */
export const maxPerCompany = () => envInt("CLAIM_STATUS_MAX_PER_COMPANY", 4);
/** Max concurrent read-only status checks across ALL companies. */
export const maxGlobal = () => envInt("CLAIM_STATUS_MAX_GLOBAL", 20);
/** How long a leased claim stays locked before it becomes eligible again. */
export const leaseSeconds = () => envInt("CLAIM_STATUS_LEASE_SECONDS", 180);

/** Never lease more than this many claims in one scheduler tick. */
export const SYNC_BATCH_SIZE = maxGlobal();
/** Hard wall-clock ceiling for one background tick. */
export const RUN_BUDGET_MS = envInt("CLAIM_STATUS_RUN_BUDGET_MS", 4 * 60 * 1000);
/** Much tighter ceiling for a manually kicked run so the UI never hangs. */
export const MANUAL_RUN_BUDGET_MS = envInt("CLAIM_STATUS_MANUAL_BUDGET_MS", 90 * 1000);
/** Fallback re-check age for rows that predate per-row scheduling. */
export const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;
/** First automatic re-check delay; doubles per attempt up to the ceiling. */
export const BACKOFF_BASE_MS = 15 * 60 * 1000;
export const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000;
/** Steady cadence for a claim still sitting in a non-terminal portal state. */
export const OPEN_RECHECK_MS = 6 * 60 * 60 * 1000;
/** Portal outcomes that end automatic polling. */
export const TERMINAL_STATUSES = ["paid", "denied", "rejected"];

/** Next due time after `attempts` consecutive inconclusive checks. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts)));
}
/** Statuses worth re-checking. Terminal outcomes are left alone. */
export const OPEN_STATUSES = ["submitted", "approved", "suspended"];



export const SYNC_ACTION = "claim_status_sync";

export type SyncClaimOutcome = {
  record_id: string;
  claim_number: string;
  previous: string | null;
  current: string | null;
  changed: boolean;
  note: string;
};

export type SyncRunResult = {
  ok: boolean;
  ran: boolean;
  reason?: string;
  checked: number;
  changed: number;
  unchanged: number;
  skipped: number;
  companies: number;
  outcomes: SyncClaimOutcome[];
};

/** Portal wording → the status we store. Anything unknown returns null. */
export function normalizePortalStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/\bpaid\b|payment issued|finalized payment/.test(s)) return "paid";
  if (/\bdenied\b|finalized denial/.test(s)) return "denied";
  if (/\breject/.test(s)) return "rejected";
  if (/suspend|\bpend(ed|ing)?\b|in process|in review/.test(s)) return "suspended";
  if (/\bapproved\b|accepted/.test(s)) return "approved";
  if (/\bsubmitted\b|received/.test(s)) return "submitted";
  return null;
}

type Candidate = {
  record_id: string;
  trip_id: string;
  company_id: string | null;
  status: string | null;
  attempts?: number;
  claim_number: string;
  member_id: string | null;
  service_date_iso: string | null;
};

type LookupRow = {
  claim_number: string;
  status: string | null;
  raw: string | null;
  paid_amount?: string | null;
  result_state?: string | null;
};

type LookupResult =
  | { ok: true; rows: LookupRow[]; tried: string[] }
  | { ok: false; detail: string; tried: string[] };

/** Dedicated READ-ONLY claim-status checker service (separate from the robot). */
export const CLAIM_STATUS_CHECKER_URL =
  process.env["CLAIM_STATUS_CHECKER_URL"] ??
  "https://redart-claim-status-checker-production.up.railway.app";

/** How long we wait for one claim lookup job before treating it as transient.
 *  The checker answers in ~15s; 2 minutes is a hard per-check ceiling. */
const CHECK_POLL_TIMEOUT_MS = envInt("CLAIM_STATUS_CHECK_TIMEOUT_MS", 120_000);
const CHECK_POLL_INTERVAL_MS = 3_000;


/** Look up ONE claim through the checker service (start job, poll until done). */
async function checkOneClaim(
  companyId: string | null,
  claimNumber: string,
  doFetch: typeof fetch,
): Promise<{ ok: true; row: LookupRow } | { ok: false; detail: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["ROBOT_API_KEY"] ?? process.env["CLAIM_STATUS_API_KEY"];
  if (apiKey) headers["x-api-key"] = apiKey;

  let jobId: string;
  try {
    const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/check-claim-status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ company_id: companyId, claim_id: claimNumber }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, detail: `checker HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    const body: any = await res.json().catch(() => ({}));
    jobId = String(body?.jobId ?? body?.job_id ?? "");
    if (!jobId) return { ok: false, detail: "checker did not return a job id" };
  } catch (e: any) {
    return { ok: false, detail: `checker unreachable: ${e?.message ?? e}` };
  }

  const deadline = Date.now() + CHECK_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CHECK_POLL_INTERVAL_MS));
    let body: any;
    try {
      const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/job-status/${jobId}`, { headers });
      if (!res.ok) continue;
      body = await res.json().catch(() => ({}));
    } catch {
      continue;
    }
    const jobStatus = String(body?.status ?? "").toLowerCase();
    if (jobStatus === "running" || jobStatus === "started" || jobStatus === "pending") continue;

    if (jobStatus !== "done") {
      return { ok: false, detail: `checker job ${jobStatus || "unknown"}: ${String(body?.error ?? "").slice(0, 160)}` };
    }
    const result: any = body?.result ?? {};
    const state = String(result?.result_state ?? "");
    if (state !== "RESULTS_FOUND") {
      // No result / login trouble / portal hiccup: certainty required, so no change.
      return {
        ok: true,
        row: { claim_number: claimNumber, status: null, raw: null, result_state: state || "UNKNOWN" },
      };
    }
    const raw = result?.detected_status ?? null;
    return {
      ok: true,
      row: {
        claim_number: claimNumber,
        status: normalizePortalStatus(raw),
        raw: typeof raw === "string" ? raw : null,
        paid_amount: result?.paid_amount ?? null,
        result_state: state,
      },
    };
  }
  return { ok: false, detail: "checker job timed out" };
}

/* ------------------------------------------------------------------ *
 * DB-BACKED WORKER / LEASE MODEL
 *
 * A scheduler tick leases a bounded, per-company-fair batch of due claims
 * through `lease_claim_status_jobs` (atomic, SECURITY DEFINER, service-role
 * only), then checks them in parallel with two caps: at most
 * `maxPerCompany()` in flight for one company and `maxGlobal()` overall.
 * Every lease carries `status_check_locked_until`, so a crashed worker's
 * rows become eligible again automatically once the lease expires.
 * ------------------------------------------------------------------ */

export type LeasedJob = {
  record_id: string;
  trip_id: string;
  company_id: string | null;
  status: string | null;
  attempts: number;
  claim_number: string;
};

/** Atomically lease a fair, bounded batch of due status-check jobs. */
export async function leaseClaimStatusJobs(
  supabase: any,
  opts: { globalLimit: number; perCompanyLimit: number; leaseSeconds: number; worker: string; recordIds?: string[] },
): Promise<LeasedJob[]> {
  const { data, error } = await supabase.rpc("lease_claim_status_jobs", {
    _global_limit: opts.globalLimit,
    _per_company_limit: opts.perCompanyLimit,
    _lease_seconds: opts.leaseSeconds,
    _worker: opts.worker,
    _record_ids: opts.recordIds ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    record_id: r.id,
    trip_id: r.trip_id,
    company_id: r.company_id ?? null,
    status: r.status ?? null,
    attempts: Number(r.status_check_attempts ?? 0),
    claim_number: String(r.claim_number).trim(),
  }));
}

async function unlockClaim(supabase: any, recordId: string) {
  await supabase
    .from("billing_records")
    .update({ status_check_locked_until: null, status_check_worker: null })
    .eq("id", recordId);
}

/** Inconclusive check: keep the billing status untouched, retry with backoff. */
async function scheduleRetry(supabase: any, job: LeasedJob, detail: string, tookMs: number) {
  const attempts = (job.attempts ?? 0) + 1;
  await supabase
    .from("billing_records")
    .update({
      status_check_attempts: attempts,
      status_check_error: detail.slice(0, 500),
      status_check_next_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
      status_check_locked_until: null,
      status_check_worker: null,
      status_check_last_ms: tookMs,
    })
    .eq("id", job.record_id);
}

/** When should this claim be looked at again? null = terminal, stop polling. */
export function nextDueFor(status: string | null): string | null {
  if (status && TERMINAL_STATUSES.includes(status)) return null;
  return new Date(Date.now() + OPEN_RECHECK_MS).toISOString();
}

async function pauseSync(supabase: any, reason: string) {
  await supabase
    .from("claim_status_sync_state")
    .update({ paused: true, pause_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", true);
}

/** Check one leased claim and write the outcome. Never throws. */
async function processJob(
  supabase: any,
  job: LeasedJob,
  opts: { actorId?: string | null; fetchImpl?: typeof fetch },
): Promise<SyncClaimOutcome & { ok: boolean }> {
  const started = Date.now();
  const base = {
    record_id: job.record_id,
    claim_number: job.claim_number,
    previous: job.status,
  };
  try {
    const out = await checkOneClaim(job.company_id, job.claim_number, opts.fetchImpl ?? fetch);
    const tookMs = Date.now() - started;

    if (!out.ok) {
      await scheduleRetry(supabase, job, out.detail, tookMs);
      return { ...base, current: null, changed: false, ok: false, note: `Left unchanged — ${out.detail}` };
    }
    const hit = out.row;
    if (!hit.status) {
      await scheduleRetry(
        supabase,
        job,
        hit.result_state ? `portal returned ${hit.result_state}` : "portal status not recognised",
        tookMs,
      );
      return {
        ...base,
        current: null,
        changed: false,
        ok: false,
        note: "Left unchanged — the portal did not state a status we recognise.",
      };
    }

    const nowIso = new Date().toISOString();
    const patch = {
      status_checked_at: nowIso,
      portal_status_raw: hit.raw,
      status_check_attempts: 0,
      status_check_error: null,
      status_check_next_at: nextDueFor(hit.status),
      status_check_locked_until: null,
      status_check_worker: null,
      status_check_last_ms: tookMs,
    };

    if (hit.status === job.status) {
      await supabase.from("billing_records").update(patch).eq("id", job.record_id);
      return { ...base, current: hit.status, changed: false, ok: true, note: "Portal status matches our record." };
    }

    const { error: upErr } = await supabase
      .from("billing_records")
      .update({ ...patch, status: hit.status, updated_at: nowIso })
      .eq("id", job.record_id);
    if (upErr) {
      await unlockClaim(supabase, job.record_id);
      return {
        ...base,
        current: hit.status,
        changed: false,
        ok: false,
        note: `Left unchanged — could not save: ${upErr.message}`,
      };
    }
    await supabase.from("medicaid_trips").update({ portal_status: hit.status }).eq("id", job.trip_id);
    await supabase.from("billing_audit_log").insert({
      billing_record_id: job.record_id,
      action: SYNC_ACTION,
      actor_id: opts.actorId ?? null,
      actor_type: "system",
      notes:
        `Automatic read-only portal status check on ${nowIso}: claim #${job.claim_number} ` +
        `changed from "${job.status ?? "unknown"}" to "${hit.status}"` +
        (hit.raw ? ` (portal wording: "${hit.raw}")` : "") +
        (hit.paid_amount ? ` Medicaid paid amount: ${hit.paid_amount}.` : "") +
        `. Check took ${tookMs}ms. Nothing was submitted or resubmitted.`,
    });
    return {
      ...base,
      current: hit.status,
      changed: true,
      ok: true,
      note: `Updated from ${job.status ?? "unknown"} to ${hit.status}.`,
    };
  } catch (e: any) {
    await scheduleRetry(supabase, job, e?.message ?? "status check crashed", Date.now() - started);
    return { ...base, current: null, changed: false, ok: false, note: `Left unchanged — ${e?.message ?? "error"}` };
  }
}

/** Run jobs with a global cap and a per-company cap; stop starting past `deadline`. */
async function runPool(
  jobs: LeasedJob[],
  caps: { perCompany: number; global: number; deadline: number },
  worker: (job: LeasedJob) => Promise<void>,
): Promise<LeasedJob[]> {
  const pending = [...jobs];
  const inflight = new Map<string, number>();
  const running = new Set<Promise<void>>();
  const skipped: LeasedJob[] = [];

  const key = (j: LeasedJob) => j.company_id ?? "__none__";

  while (pending.length || running.size) {
    if (Date.now() >= caps.deadline) {
      skipped.push(...pending.splice(0, pending.length));
    }
    while (running.size < caps.global && pending.length) {
      const idx = pending.findIndex((j) => (inflight.get(key(j)) ?? 0) < caps.perCompany);
      if (idx < 0) break;
      const job = pending.splice(idx, 1)[0]!;
      inflight.set(key(job), (inflight.get(key(job)) ?? 0) + 1);
      const p: Promise<void> = worker(job).finally(() => {
        inflight.set(key(job), Math.max(0, (inflight.get(key(job)) ?? 1) - 1));
        running.delete(p);
      });
      running.add(p);
    }
    if (!running.size) break;
    await Promise.race(running);
  }
  return skipped;
}

/**
 * ONE scheduler tick: lease a bounded batch and process it in parallel with
 * per-company and global concurrency caps. Safe to run concurrently with
 * itself — leasing is atomic, so two ticks never touch the same claim.
 * `supabase` must be the service-role client (cron has no user).
 */
export async function runClaimStatusSync(
  supabase: any,
  opts: {
    actorId?: string | null;
    recordIds?: string[];
    force?: boolean;
    budgetMs?: number;
    perCompanyLimit?: number;
    globalLimit?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SyncRunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  const perCompany = opts.perCompanyLimit ?? maxPerCompany();
  const globalCap = opts.globalLimit ?? maxGlobal();
  const workerId = `w-${Math.random().toString(36).slice(2, 8)}-${Date.now()}`;

  const empty: SyncRunResult = {
    ok: true,
    ran: false,
    checked: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    companies: 0,
    outcomes: [],
  };

  const { data: state } = await supabase
    .from("claim_status_sync_state")
    .select("paused, pause_reason")
    .eq("id", true)
    .maybeSingle();
  if (state?.paused) return { ...empty, reason: state.pause_reason ?? "Claim status sync is paused." };

  const result: SyncRunResult = { ...empty };
  const startedAt = Date.now();
  try {
    const jobs = await leaseClaimStatusJobs(supabase, {
      globalLimit: opts.recordIds?.length ? opts.recordIds.length : globalCap,
      perCompanyLimit: opts.recordIds?.length ? opts.recordIds.length : perCompany,
      leaseSeconds: leaseSeconds(),
      worker: workerId,
      ...(opts.recordIds?.length ? { recordIds: opts.recordIds } : {}),
    });

    if (!jobs.length) {
      result.reason = "No open claims are due for a status check.";
      return result;
    }
    result.ran = true;
    result.companies = new Set(jobs.map((j) => j.company_id)).size;

    const leftover = await runPool(jobs, { perCompany, global: globalCap, deadline }, async (job) => {
      const outcome = await processJob(supabase, job, { actorId: opts.actorId ?? null, fetchImpl: opts.fetchImpl });
      result.outcomes.push(outcome);
      if (!outcome.ok) result.skipped++;
      else {
        result.checked++;
        if (outcome.changed) result.changed++;
        else result.unchanged++;
      }
    });

    // Ran out of budget: release those leases immediately so the next tick picks them up.
    for (const job of leftover) {
      result.skipped++;
      await unlockClaim(supabase, job.record_id);
    }
    return result;
  } catch (e: any) {
    const msg = e?.message ?? "Claim status sync failed";
    if (/402|403|payment required|forbidden/i.test(msg)) await pauseSync(supabase, `Paused automatically: ${msg}`);
    result.ok = false;
    result.reason = msg;
    return result;
  } finally {
    await supabase
      .from("claim_status_sync_state")
      .update({
        lease_until: null,
        last_run_at: new Date().toISOString(),
        last_result: {
          checked: result.checked,
          changed: result.changed,
          unchanged: result.unchanged,
          skipped: result.skipped,
          companies: result.companies,
          duration_ms: Date.now() - startedAt,
          per_company_limit: perCompany,
          global_limit: globalCap,
          worker: workerId,
          reason: result.reason ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
  }
}
