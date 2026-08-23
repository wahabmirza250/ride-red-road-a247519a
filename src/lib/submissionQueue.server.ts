/**
 * PERSISTENT SUBMISSION QUEUE (server-side worker layer).
 *
 * This module is the scalable, crash-safe orchestration around the EXISTING
 * HCPF submission robot. The robot itself is frozen: every dispatch still goes
 * through `startRobotSubmission` with the same payload/mode, and every outcome
 * is still reconciled by `robotReconcile.server.ts`, which is what feeds the
 * read-only claim-status queue.
 *
 * Guarantees:
 *   - All queue state lives in Postgres (`billing_records.submit_*` columns).
 *     A restart of the app or the worker loses nothing.
 *   - Tenant isolation: leases are company-scoped; a signed-in caller can only
 *     ever lease its own company's work (enforced inside the RPC).
 *   - At-most-once active submission per bill: the atomic
 *     `lease_submission_jobs` RPC hands a row to exactly one dispatcher, and
 *     the row is then claimed with a conditional `queued -> submitting` update.
 *   - Fast failure: a bad claim is released with backoff instead of holding a
 *     slot; healthy claims keep flowing.
 *   - Never blind-resubmits an uncertain outcome — anything that might already
 *     exist at the portal is routed to reconciliation / human attention.
 */
import {
  startRobotSubmission,
  logAudit,
  looksLikeRetryableTimeout,
} from "@/lib/billingHelpers";
import {
  listActiveRobotJobs,
  riderKeyOf,
  resolveProviderUserId,
  MAX_CONCURRENT_JOBS_PER_RIDER,
  ROBOT_JOB_STALE_MS,
} from "@/lib/robotQueue.server";

/* ---------------- Env-backed, clamped scaling limits ---------------- */

export function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Max concurrent real portal submissions for ONE company. Default keeps the
 *  proven production throughput of 8 live portal sessions per provider. */
export const maxSubmitPerCompany = () => envInt("SUBMIT_MAX_PER_COMPANY", 8, 1, 50);
/** Max concurrent real portal submissions across ALL companies. */
export const maxSubmitGlobal = () => envInt("SUBMIT_MAX_GLOBAL", 20, 1, 200);
/** How long a leased bill stays locked to one worker. */
export const submitLeaseSeconds = () => envInt("SUBMIT_LEASE_SECONDS", 300, 60, 3600);
/** Locks this far past expiry are swept as abandoned. */
export const submitStaleGraceSeconds = () => envInt("SUBMIT_STALE_GRACE_SECONDS", 300, 60, 3600);
/** Hard wall-clock ceiling for one scheduler tick. */
export const SUBMIT_RUN_BUDGET_MS = () => envInt("SUBMIT_RUN_BUDGET_MS", 100_000, 10_000, 240_000);
/** Attempts (including the first) before a bill needs a human. */
export const maxSubmitAttempts = () => envInt("SUBMIT_MAX_ATTEMPTS", 3, 1, 10);

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

/** Delay before attempt `attempt + 1` (exponential, capped). */
export function submitBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt)));
}

/** Errors that are safe to retry with identical data. */
export function isTransientSubmitError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  if (looksLikeRetryableTimeout(msg)) return true;
  return (
    /fetch failed|network|ECONNRESET|ECONNREFUSED|socket hang up|502|503|504|temporarily unavailable|rejected the request \(5\d\d\)/i.test(
      String(msg),
    )
  );
}

/**
 * Outcomes that may or may not have created a real claim at the portal.
 * These are NEVER auto-retried — the reconciler / claim search decides.
 */
export function isAmbiguousSubmitError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return /confirm|already submitted|claim may exist|SUBMITTED_UNVERIFIED/i.test(String(msg));
}

export type QueueTickResult = {
  ok: boolean;
  ran: boolean;
  reason?: string;
  leased: number;
  started: number;
  paced: number;
  retried: number;
  failed: number;
  recovered: number;
  staleLocksReleased: number;
  checked: number;
  settled: number;
  startedIds: string[];
  ms: number;
};

const TRIP_SELECT = `id, status, trip_id, company_id, submit_attempt_count,
   medicaid_trips!inner(
     id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
     state_pdf_path, identity_verified, robot_job_id, robot_job_started_at,
     robot_last_status, status, portal_status, robot_confirmation_number,
     submitted_confirmation, vehicle_type, trip_kind, rider_id, created_by,
     riders(medicaid_id)
   )`;

/* ---------------- Pause control (independent of status sync) ------------- */

export async function isSubmissionQueuePaused(
  supabase: any,
): Promise<{ paused: boolean; reason: string | null }> {
  const { data } = await supabase
    .from("submission_queue_state")
    .select("paused, pause_reason")
    .eq("id", true)
    .maybeSingle();
  return { paused: Boolean(data?.paused), reason: data?.pause_reason ?? null };
}

async function recordRun(supabase: any, result: QueueTickResult) {
  try {
    await supabase
      .from("submission_queue_state")
      .update({
        last_run_at: new Date().toISOString(),
        last_result: {
          leased: result.leased,
          started: result.started,
          paced: result.paced,
          retried: result.retried,
          failed: result.failed,
          recovered: result.recovered,
          ms: result.ms,
          reason: result.reason ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
  } catch {
    /* metrics must never break the worker */
  }
}

/* ---------------- Self-healing ------------------------------------------ */

/** Abandoned leases on still-queued rows become eligible again. */
export async function releaseStaleSubmissionLocks(supabase: any): Promise<number> {
  const { data, error } = await supabase.rpc("release_stale_submission_locks", {
    _grace_seconds: submitStaleGraceSeconds(),
  });
  if (error) return 0;
  return Number(data ?? 0);
}

/**
 * CRASH RECOVERY, SAFELY.
 *
 * A worker that died between "claim the row" and "the robot answered" leaves a
 * `submitting` row with no robot job id. We cannot prove the portal was not
 * touched, so it is NEVER auto-resubmitted: it goes to human attention.
 */
export async function recoverOrphanedSubmissions(
  supabase: any,
  companyId?: string | null,
): Promise<number> {
  const cutoff = new Date(Date.now() - ROBOT_JOB_STALE_MS).toISOString();
  let q = supabase
    .from("billing_records")
    .select("id, trip_id, updated_at, medicaid_trips!inner(robot_job_id)")
    .eq("status", "submitting")
    .lt("updated_at", cutoff);
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) return 0;

  const orphans = (data ?? []).filter((r: any) => !r.medicaid_trips?.robot_job_id);
  for (const r of orphans) {
    const msg =
      "The worker stopped before the automation service confirmed this job. " +
      "It was NOT retried automatically because a claim may already exist at the portal — please check the portal and use Edit & fix or Resubmit.";
    await supabase
      .from("billing_records")
      .update({
        status: "needs_fix",
        requires_human_step: true,
        submission_error: msg,
        fix_notes: msg,
        submit_locked_until: null,
        submit_worker: null,
        submit_last_error: msg,
      })
      .eq("id", r.id)
      .eq("status", "submitting");
    await logAudit(supabase, r.id, null, "submission_orphan_recovered", msg);
  }
  return orphans.length;
}

/* ---------------- Leasing ------------------------------------------------ */

export type SubmissionLease = {
  id: string;
  trip_id: string;
  company_id: string | null;
  attempt: number;
};

export async function leaseSubmissionJobs(
  supabase: any,
  opts: { worker: string; companyId?: string | null; recordIds?: string[] | null } = {
    worker: "worker",
  },
): Promise<SubmissionLease[]> {
  const { data, error } = await supabase.rpc("lease_submission_jobs", {
    _global_limit: maxSubmitGlobal(),
    _per_company_limit: maxSubmitPerCompany(),
    _lease_seconds: submitLeaseSeconds(),
    _worker: opts.worker,
    _company_id: opts.companyId ?? null,
    _stale_seconds: Math.round(ROBOT_JOB_STALE_MS / 1000),
    _record_ids: opts.recordIds ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as SubmissionLease[];
}

/** Give a lease back without consuming an attempt (paced / not our turn). */
async function releaseLease(supabase: any, id: string) {
  await supabase
    .from("billing_records")
    .update({ submit_locked_until: null, submit_worker: null })
    .eq("id", id);
}

/** Park a failed attempt for a later retry, or hand it to a human. */
export async function scheduleRetryOrFail(
  supabase: any,
  args: { id: string; tripId: string; attempt: number; error: string; actorId: string | null },
): Promise<"retry" | "failed"> {
  const { id, attempt, error, actorId } = args;
  const nextAttempt = attempt + 1;
  const transient = isTransientSubmitError(error) && !isAmbiguousSubmitError(error);
  const canRetry = transient && nextAttempt < maxSubmitAttempts();

  if (canRetry) {
    const delay = submitBackoffMs(attempt);
    await supabase
      .from("billing_records")
      .update({
        status: "queued",
        submit_attempt_count: nextAttempt,
        submit_next_attempt_at: new Date(Date.now() + delay).toISOString(),
        submit_locked_until: null,
        submit_worker: null,
        submit_last_error: error.slice(0, 500),
        submission_error: error.slice(0, 500),
        requires_human_step: false,
      })
      .eq("id", id);
    await logAudit(
      supabase,
      id,
      actorId,
      "submission_retry_scheduled",
      `Attempt ${nextAttempt} of ${maxSubmitAttempts()} in ${Math.round(delay / 1000)}s. Last error: ${error.slice(0, 300)}`,
    );
    return "retry";
  }

  await supabase
    .from("billing_records")
    .update({
      status: "needs_fix",
      submit_attempt_count: nextAttempt,
      submit_next_attempt_at: null,
      submit_locked_until: null,
      submit_worker: null,
      submit_last_error: error.slice(0, 500),
      submission_error: error.slice(0, 500),
      fix_notes: error.slice(0, 500),
      requires_human_step: isAmbiguousSubmitError(error),
    })
    .eq("id", id);
  await logAudit(
    supabase,
    id,
    actorId,
    "submission_needs_attention",
    `Stopped after ${nextAttempt} attempt(s): ${error.slice(0, 300)}`,
  );
  return "failed";
}

/* ---------------- Dispatch ---------------------------------------------- */

/**
 * Lease a bounded batch and start the robot for each leased bill, honouring
 * the same-passenger pacing rule. Returns immediately after dispatch — the
 * existing reconcile path collects the real outcomes.
 */
export async function dispatchLeasedSubmissions(
  supabase: any,
  actorId: string | null,
  opts: { companyId?: string | null; worker?: string; recordIds?: string[] | null } = {},
): Promise<{ leased: number; started: number; paced: number; retried: number; failed: number; startedIds: string[] }> {
  const worker = opts.worker ?? `w-${Math.random().toString(36).slice(2, 10)}`;
  const leases = await leaseSubmissionJobs(supabase, {
    worker,
    companyId: opts.companyId ?? null,
    recordIds: opts.recordIds ?? null,
  });
  if (leases.length === 0) {
    return { leased: 0, started: 0, paced: 0, retried: 0, failed: 0, startedIds: [] };
  }

  // Same-passenger pacing: the portal chokes when several sessions touch one
  // member at once. Live counts come from the DB, not memory.
  const active = await listActiveRobotJobs(supabase, { companyId: opts.companyId ?? null });
  const riderLive = new Map<string, number>();
  for (const a of active) {
    if (!a.riderKey) continue;
    riderLive.set(a.riderKey, (riderLive.get(a.riderKey) ?? 0) + 1);
  }

  const { data: rows, error } = await supabase
    .from("billing_records")
    .select(TRIP_SELECT)
    .in(
      "id",
      leases.map((l) => l.id),
    );
  if (error) throw new Error(error.message);
  const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));

  let paced = 0;
  let retried = 0;
  let failed = 0;
  const dispatchable: Array<{ lease: SubmissionLease; rec: any }> = [];

  for (const lease of leases) {
    const rec = byId.get(lease.id);
    if (!rec) {
      await releaseLease(supabase, lease.id);
      continue;
    }
    const key = riderKeyOf(rec.medicaid_trips);
    if (key) {
      const live = riderLive.get(key) ?? 0;
      if (live >= MAX_CONCURRENT_JOBS_PER_RIDER) {
        await releaseLease(supabase, lease.id); // stays `queued`, no attempt burnt
        paced++;
        continue;
      }
      riderLive.set(key, live + 1);
    }
    dispatchable.push({ lease, rec });
  }

  const results = await Promise.all(
    dispatchable.map(async ({ lease, rec }) => {
      // Conditional claim: the row must still be `queued`. Two dispatchers can
      // never both flip the same row.
      const { data: claimed } = await supabase
        .from("billing_records")
        .update({ status: "submitting", submission_error: null, requires_human_step: false })
        .eq("id", rec.id)
        .eq("status", "queued")
        .select("id");
      if ((claimed ?? []).length === 0) return null;

      const startedAt = Date.now();
      let provider: string | null = null;
      try {
        provider = await resolveProviderUserId(supabase, {
          actorId,
          trip: rec.medicaid_trips,
          companyId: rec.company_id,
        });
        await startRobotSubmission(supabase, {
          billingRecordId: rec.id,
          trip: rec.medicaid_trips,
          providerUserId: provider,
          // Queued work is always a real one-shot submission — unchanged.
          mode: "full",
        });
        await supabase
          .from("billing_records")
          .update({
            submit_locked_until: null,
            submit_worker: null,
            submit_last_error: null,
            submit_next_attempt_at: null,
            submit_last_ms: Date.now() - startedAt,
          })
          .eq("id", rec.id);
        await logAudit(supabase, rec.id, provider, "robot_started_from_queue");
        return rec.id as string;
      } catch (e: any) {
        const msg = e?.message ?? "Failed to start the queued automation";
        const outcome = await scheduleRetryOrFail(supabase, {
          id: rec.id,
          tripId: rec.trip_id,
          attempt: Number(rec.submit_attempt_count ?? lease.attempt ?? 0),
          error: msg,
          actorId: provider ?? actorId,
        });
        if (outcome === "retry") retried++;
        else failed++;
        return null;
      }
    }),
  );

  const startedIds = results.filter((x): x is string => Boolean(x));
  return {
    leased: leases.length,
    started: startedIds.length,
    paced,
    retried,
    failed,
    startedIds,
  };
}

/**
 * ONE SCHEDULER TICK.
 *
 * Bounded, crash-safe and idempotent: self-heal, reconcile in-flight jobs
 * through the EXISTING reconcile path, then lease and dispatch a bounded batch
 * and exit. Nothing is kept alive between ticks.
 */
export async function runSubmissionQueueTick(
  supabase: any,
  opts: { actorId?: string | null; companyId?: string | null; worker?: string } = {},
): Promise<QueueTickResult> {
  const t0 = Date.now();
  const base: QueueTickResult = {
    ok: true,
    ran: false,
    leased: 0,
    started: 0,
    paced: 0,
    retried: 0,
    failed: 0,
    recovered: 0,
    staleLocksReleased: 0,
    checked: 0,
    settled: 0,
    startedIds: [],
    ms: 0,
  };

  const { paused, reason } = await isSubmissionQueuePaused(supabase);
  if (paused) {
    const out = { ...base, reason: reason ?? "Submission queue is paused", ms: Date.now() - t0 };
    await recordRun(supabase, out);
    return out;
  }

  const staleLocksReleased = await releaseStaleSubmissionLocks(supabase);
  const recovered = await recoverOrphanedSubmissions(supabase, opts.companyId ?? null);

  // Reconciliation stays on the proven path so claim ids/statuses populate
  // exactly as today and feed the read-only status-check queue.
  const { reconcileInFlight } = await import("@/lib/robotQueue.server");
  const reconciled = await reconcileInFlight(
    supabase,
    opts.actorId ?? null,
    opts.companyId ?? null,
  );

  const budget = SUBMIT_RUN_BUDGET_MS();
  let dispatch = { leased: 0, started: 0, paced: 0, retried: 0, failed: 0, startedIds: [] as string[] };
  if (Date.now() - t0 < budget) {
    dispatch = await dispatchLeasedSubmissions(supabase, opts.actorId ?? null, {
      companyId: opts.companyId ?? null,
      worker: opts.worker ?? `tick-${t0}`,
    });
  }

  const out: QueueTickResult = {
    ...base,
    ran: true,
    ...dispatch,
    recovered,
    staleLocksReleased,
    checked: reconciled.checked,
    settled: reconciled.settled,
    ms: Date.now() - t0,
  };
  await recordRun(supabase, out);
  return out;
}
