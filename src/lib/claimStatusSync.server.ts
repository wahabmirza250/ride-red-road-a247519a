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
import { denverDateISO } from "@/lib/billingHelpers";

/** Never check more than this many claims in one scheduled run. */
export const SYNC_BATCH_SIZE = 40;
/** Claims checked more recently than this are skipped. */
export const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;
/** How long one run may hold the single-flight lease. */
export const LEASE_MS = 10 * 60 * 1000;
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

function portalDateMDY(iso: string | null | undefined): string {
  const [y, m, d] = denverDateISO(iso ?? undefined).split("-");
  return `${m}/${d}/${y}`;
}

type Candidate = {
  record_id: string;
  trip_id: string;
  company_id: string | null;
  status: string | null;
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
  | { ok: true; rows: LookupRow[] }
  | { ok: false; detail: string };

/** Dedicated READ-ONLY claim-status checker service (separate from the robot). */
export const CLAIM_STATUS_CHECKER_URL =
  process.env["CLAIM_STATUS_CHECKER_URL"] ??
  "https://redart-claim-status-checker-production.up.railway.app";

/** How long we wait for one claim lookup job before treating it as transient. */
const CHECK_POLL_TIMEOUT_MS = 120_000;
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

/**
 * READ-ONLY portal status lookup for a group of claims from one company.
 * Runs strictly one claim at a time: the portal bounces a second concurrent
 * session on the same login, and the submission robot shares that login.
 */
export async function lookupClaimStatuses(args: {
  companyId: string | null;
  portalId: string | null;
  providerUserId: string | null;
  claims: Candidate[];
  fetchImpl?: typeof fetch;
}): Promise<LookupResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const rows: LookupRow[] = [];
  let anyOk = false;
  let lastDetail = "claim status checker unavailable";

  for (const c of args.claims) {
    const out = await checkOneClaim(args.companyId, c.claim_number, doFetch);
    if (out.ok) {
      anyOk = true;
      rows.push(out.row);
    } else {
      lastDetail = out.detail;
    }
  }
  return anyOk ? { ok: true, rows } : { ok: false, detail: lastDetail };
}


/** Single-flight lease. Returns false when another run already holds it. */
async function acquireLease(supabase: any): Promise<boolean> {
  const now = new Date();
  const { data, error } = await supabase
    .from("claim_status_sync_state")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), updated_at: now.toISOString() })
    .eq("id", true)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

async function releaseLease(supabase: any, result: SyncRunResult) {
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
        reason: result.reason ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
}

async function pauseSync(supabase: any, reason: string) {
  await supabase
    .from("claim_status_sync_state")
    .update({ paused: true, pause_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", true);
}

/**
 * One bounded, read-only status-sync pass over every company's open claims.
 * `supabase` must be the service-role client (the cron entry point has no user).
 */
export async function runClaimStatusSync(
  supabase: any,
  opts: {
    actorId?: string | null;
    recordIds?: string[];
    force?: boolean;
    /** Test seam only: lets a harness stand in for the portal call. */
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SyncRunResult> {
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
  if (state?.paused) {
    return { ...empty, reason: state.pause_reason ?? "Claim status sync is paused." };
  }

  if (!(await acquireLease(supabase))) {
    return { ...empty, reason: "Another status sync run is already in progress." };
  }

  const result: SyncRunResult = { ...empty, ran: true };
  try {
    // Candidate claims: real portal claim numbers whose outcome is still open.
    let q = supabase
      .from("billing_records")
      .select(
        `id, trip_id, company_id, status, state_confirmation_number, status_checked_at,
         medicaid_trips!inner(id, pickup_at, company_id, robot_confirmation_number, submitted_confirmation, riders(medicaid_id))`,
      )
      .in("status", OPEN_STATUSES)
      .order("status_checked_at", { ascending: true, nullsFirst: true })
      .limit(opts.recordIds?.length ? opts.recordIds.length : SYNC_BATCH_SIZE);
    if (opts.recordIds?.length) q = q.in("id", opts.recordIds);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const cutoff = Date.now() - RECHECK_AFTER_MS;
    const candidates: Candidate[] = [];
    for (const r of rows ?? []) {
      const trip: any = (r as any).medicaid_trips;
      const claim =
        (r as any).state_confirmation_number ??
        trip?.robot_confirmation_number ??
        trip?.submitted_confirmation ??
        null;
      if (!claim) {
        result.skipped++;
        continue;
      }
      const checkedAt = (r as any).status_checked_at ? new Date((r as any).status_checked_at).getTime() : 0;
      if (!opts.force && !opts.recordIds?.length && checkedAt > cutoff) {
        result.skipped++;
        continue;
      }
      candidates.push({
        record_id: (r as any).id,
        trip_id: (r as any).trip_id,
        company_id: (r as any).company_id ?? trip?.company_id ?? null,
        status: (r as any).status ?? null,
        claim_number: String(claim).trim(),
        member_id: trip?.riders?.medicaid_id ?? null,
        service_date_iso: trip?.pickup_at ?? null,
      });
    }

    if (!candidates.length) {
      result.reason = "No open claims are due for a status check.";
      return result;
    }

    // Never compete with live submissions: a company with a queued or running
    // submission is left entirely for the next run.
    const companyIds = [...new Set(candidates.map((c) => c.company_id))];
    const { data: busyRows } = await supabase
      .from("billing_records")
      .select("company_id")
      .in("status", ["queued", "submitting"]);
    const busy = new Set((busyRows ?? []).map((b: any) => b.company_id));

    for (const companyId of companyIds) {
      const group = candidates.filter((c) => c.company_id === companyId);
      if (busy.has(companyId)) {
        result.skipped += group.length;
        continue;
      }
      result.companies++;

      let portalId: string | null = null;
      let providerUserId: string | null = null;
      try {
        const { requireCompanyPortalCredential } = await import("@/lib/billingHelpers");
        const cred = await requireCompanyPortalCredential(supabase, companyId ?? "");
        portalId = cred.portal_id;
      } catch {
        portalId = null;
      }
      providerUserId = opts.actorId ?? null;

      const lookup = await lookupClaimStatuses({
        companyId,
        portalId,
        providerUserId,
        claims: group,
        fetchImpl: opts.fetchImpl,
      });

      if (!lookup.ok) {
        // Uncertain: change nothing, record nothing as checked.
        result.skipped += group.length;
        for (const c of group) {
          result.outcomes.push({
            record_id: c.record_id,
            claim_number: c.claim_number,
            previous: c.status,
            current: null,
            changed: false,
            note: `Left unchanged — ${lookup.detail}`,
          });
        }
        continue;
      }

      const byClaim = new Map(lookup.rows.map((r) => [r.claim_number, r]));
      const nowIso = new Date().toISOString();
      for (const c of group) {
        const hit = byClaim.get(c.claim_number);
        if (!hit || !hit.status) {
          result.skipped++;
          result.outcomes.push({
            record_id: c.record_id,
            claim_number: c.claim_number,
            previous: c.status,
            current: null,
            changed: false,
            note: "Left unchanged — the portal did not state a status we recognise.",
          });
          continue;
        }
        result.checked++;

        if (hit.status === c.status) {
          result.unchanged++;
          await supabase
            .from("billing_records")
            .update({ status_checked_at: nowIso, portal_status_raw: hit.raw })
            .eq("id", c.record_id);
          result.outcomes.push({
            record_id: c.record_id,
            claim_number: c.claim_number,
            previous: c.status,
            current: hit.status,
            changed: false,
            note: "Portal status matches our record.",
          });
          continue;
        }

        const { error: upErr } = await supabase
          .from("billing_records")
          .update({
            status: hit.status,
            status_checked_at: nowIso,
            portal_status_raw: hit.raw,
            updated_at: nowIso,
          })
          .eq("id", c.record_id);
        if (upErr) {
          result.skipped++;
          result.outcomes.push({
            record_id: c.record_id,
            claim_number: c.claim_number,
            previous: c.status,
            current: hit.status,
            changed: false,
            note: `Left unchanged — could not save: ${upErr.message}`,
          });
          continue;
        }
        await supabase
          .from("medicaid_trips")
          .update({ portal_status: hit.status })
          .eq("id", c.trip_id);
        await supabase.from("billing_audit_log").insert({
          billing_record_id: c.record_id,
          action: SYNC_ACTION,
          actor_id: opts.actorId ?? null,
          actor_type: "system",
          notes:
            `Automatic read-only portal status check on ${nowIso}: claim #${c.claim_number} ` +
            `changed from "${c.status ?? "unknown"}" to "${hit.status}"` +
            (hit.raw ? ` (portal wording: "${hit.raw}")` : "") +
            ". Nothing was submitted or resubmitted.",
        });
        result.changed++;
        result.outcomes.push({
          record_id: c.record_id,
          claim_number: c.claim_number,
          previous: c.status,
          current: hit.status,
          changed: true,
          note: `Updated from ${c.status ?? "unknown"} to ${hit.status}.`,
        });
      }
    }

    return result;
  } catch (e: any) {
    const msg = e?.message ?? "Claim status sync failed";
    if (/402|403|payment required|forbidden/i.test(msg)) {
      await pauseSync(supabase, `Paused automatically: ${msg}`);
    }
    result.ok = false;
    result.reason = msg;
    return result;
  } finally {
    await releaseLease(supabase, result);
  }
}
