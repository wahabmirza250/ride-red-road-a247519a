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
  looksLikePossiblySubmittedTimeout,
  looksLikeRetryableTimeout,
  hasExplicitPreSubmitFailureEvidence,

} from "@/lib/billingHelpers";
import {
  isInfrastructureSubmitError,
  classifySubmitFailure,
  sanitizeSubmitError,
  AMBIGUOUS_USER_MESSAGE,
  isPortalStep1ValidationFailure,
  PORTAL_STEP1_USER_MESSAGE,
  isAccountBusyPreSubmitError,
  isPreSubmitPacingCondition,
  PORTAL_NAV_USER_MESSAGE,
  isFleetUnavailable,
  ACCOUNT_BUSY_USER_MESSAGE,
  LAUNCH_BUSY_USER_MESSAGE,
  INFRA_USER_MESSAGE,
} from "@/lib/submitErrors";

import {
  listActiveRobotJobs,
  riderKeyOf,
  resolveProviderUserId,
  MAX_CONCURRENT_JOBS_PER_RIDER,
  ROBOT_JOB_STALE_MS,
} from "@/lib/robotQueue.server";

import { isPortalNavigationFailure } from "@/lib/portalNavigation";
import { loadFleet, effectiveGlobalLimit } from "@/lib/robotFleet.server";

/* ---------------- Env-backed, clamped scaling limits ---------------- */

export { envInt } from "@/lib/submissionQueueEnv";
import { envInt } from "@/lib/submissionQueueEnv";

/**
 * CONTROLLED CONCURRENCY PER PROVIDER/COMPANY ACCOUNT.
 *
 * Live Railway evidence showed that UNBOUNDED simultaneous portal sessions on
 * one provider account flood the automation worker (Chromium spawn EAGAIN,
 * closed browsers, 480s timeouts). The automation service itself supports
 * bounded concurrency (its own server caps at 8), so RedArt runs a staged
 * DEFAULT of 6 active HCPF submissions per account (ramped up from 4 after the
 * two-worker fleet proved stable) and allows an operator to ramp to at most 8
 * via `SUBMIT_MAX_PER_COMPANY` — the clamp keeps configuration from ever going
 * past what the automation service supports.
 * Duplicate protection does not rely on this number: it comes from idempotency
 * keys, conditional status flips and per-rider single flight.
 */
export const maxSubmitPerCompany = () => envInt("SUBMIT_MAX_PER_COMPANY", 6, 1, 8);

/** Max concurrent real portal submissions across ALL companies (separate accounts). */
export const maxSubmitGlobal = () => envInt("SUBMIT_MAX_GLOBAL", 20, 1, 200);
/** How long a leased bill stays locked to one worker. */
export const submitLeaseSeconds = () => envInt("SUBMIT_LEASE_SECONDS", 300, 60, 3600);
/** Locks this far past expiry are swept as abandoned. */
export const submitStaleGraceSeconds = () => envInt("SUBMIT_STALE_GRACE_SECONDS", 300, 60, 3600);
/** Hard wall-clock ceiling for one scheduler tick. */
export const SUBMIT_RUN_BUDGET_MS = () => envInt("SUBMIT_RUN_BUDGET_MS", 100_000, 10_000, 240_000);
/** Attempts (including the first) before a bill needs a human. */
export const maxSubmitAttempts = () => envInt("SUBMIT_MAX_ATTEMPTS", 3, 1, 10);
/** Cooldown after a worker/browser-level failure before the next attempt. */
export const submitInfraCooldownMs = () =>
  envInt("SUBMIT_INFRA_COOLDOWN_MS", 90_000, 10_000, 15 * 60_000);

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

/**
 * IMMEDIATE-REFILL LOOP. After a claim reconciles as finished, the freed
 * freed account slot is refilled inside the same tick instead of waiting for
 * the next cron minute. These are poll/round bounds, NOT a cooldown.
 */
export const SUBMIT_REFILL_POLL_MS = envInt("SUBMIT_REFILL_POLL_MS", 2_500, 1_000, 30_000);
export const SUBMIT_REFILL_MAX_ROUNDS = envInt("SUBMIT_REFILL_MAX_ROUNDS", 20, 0, 100);


const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


/** Delay before attempt `attempt + 1` (exponential, capped). */
export function submitBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt)));
}

/** Errors that are safe to retry with identical data. */
export function isTransientSubmitError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  if (isAmbiguousSubmitError(msg)) return false;
  // A timeout on its own proves nothing about where the run died. Without
  // explicit pre-Submit evidence it is parked, never automatically re-queued.
  const timeoutish = /timed out|timeout|ETIMEDOUT/i.test(String(msg));
  if (timeoutish && !hasExplicitPreSubmitFailureEvidence(msg)) return false;
  if (looksLikeRetryableTimeout(msg)) return true;
  if (isInfrastructureSubmitError(msg)) return true;
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
  return (
    /confirm|already submitted|claim may exist|SUBMITTED_UNVERIFIED/i.test(String(msg)) ||
    looksLikePossiblySubmittedTimeout(msg)
  );
}

/**
 * DB-side proof that a bill may already have reached the portal. Checked before
 * ANY retry: if there is any evidence at all, the bill is routed to awaiting
 * verification instead of being resubmitted.
 */
export function hasPortalClaimEvidence(rec: any): boolean {
  const trip = rec?.medicaid_trips ?? rec ?? {};
  if (trip.robot_confirmation_number || trip.submitted_confirmation) return true;
  if (rec?.state_confirmation_number) return true;
  const robot = String(trip.robot_last_status ?? "");
  if (/^SUBMITTED/i.test(robot)) return true;
  const portal = String(trip.portal_status ?? "");
  if (/submitted|paid|approved|suspended|denied/i.test(portal)) return true;
  if (String(trip.status ?? "") === "submitted") return true;
  return false;
}

/**
 * Park a bill for human verification instead of retrying it. Used whenever a
 * previous attempt ended ambiguously or left claim evidence behind.
 */
export async function parkForVerification(
  supabase: any,
  args: { id: string; actorId: string | null; detail: string },
): Promise<void> {
  const note = `${AMBIGUOUS_USER_MESSAGE} ${args.detail}`.trim();
  await supabase
    .from("billing_records")
    .update({
      status: "needs_fix",
      requires_human_step: true,
      submission_error: AMBIGUOUS_USER_MESSAGE,
      fix_notes: note,
      submit_locked_until: null,
      submit_worker: null,
      submit_next_attempt_at: null,
      submit_last_error: note.slice(0, 500),
      failure_stage: "portal_submit",
      failure_code: "ambiguous_outcome",
    })
    .eq("id", args.id);
  await logAudit(supabase, args.id, args.actorId, "submission_awaiting_verification", note);
}


export type QueueTickResult = {
  ok: boolean;
  ran: boolean;
  reason?: string;
  leased: number;
  started: number;
  paced: number;
  blocked: number;
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
   submit_last_error, state_confirmation_number,
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
        failure_stage: "worker",
        failure_code: "worker_unavailable",
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

/**
 * STUCK-FOREVER GUARD.
 *
 * A bill that really started a robot job but never reached a terminal outcome
 * (worker restarted, connection lost, poll never answered) must not sit in
 * `submitting` indefinitely. Past the absolute ceiling it is classified exactly
 * like a lost job: Needs Verification via the read-only portal search, never an
 * automatic retry, with the job id / idempotency key / account key preserved.
 */
export async function recoverStuckInFlightSubmissions(
  supabase: any,
  companyId?: string | null,
): Promise<number> {
  const {
    exceededInFlightCeiling,
    isQuarantinedRobotStatus,
    isActiveVerifyRobotStatus,
    INFLIGHT_CEILING_VERIFY_MESSAGE,
    QUARANTINE_MESSAGE,
  } = await import("@/lib/robotJobLost");
  const { routeToNeedsVerification, quarantineForHumanVerification } = await import(
    "@/lib/robotJobLost.server"
  );

  let q = supabase
    .from("billing_records")
    .select(
      `id, trip_id, requires_human_step, submission_error, updated_at,
       medicaid_trips!inner(id, robot_job_id, robot_job_started_at, robot_last_status, robot_last_message)`,
    )
    .eq("status", "submitting");
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) return 0;

  const now = Date.now();
  let n = 0;
  for (const r of data ?? []) {
    const trip: any = r.medicaid_trips ?? {};
    const robotStatus = String(trip.robot_last_status ?? "");
    const started = trip.robot_job_started_at ?? r.updated_at ?? null;

    // TERMINAL HUMAN STATE: automation is done with this bill. It must not stay
    // counted as active `submitting` — quarantine it now, keeping all evidence.
    // Rows still owned by the bounded read-only portal search are exempt until
    // the ceiling below.
    if (
      isQuarantinedRobotStatus(robotStatus) ||
      (r.requires_human_step && !isActiveVerifyRobotStatus(robotStatus))
    ) {
      await quarantineForHumanVerification(supabase, {
        recordId: r.id,
        tripId: trip.id ?? r.trip_id,
        actorId: null,
        message:
          trip.robot_last_message || r.submission_error || QUARANTINE_MESSAGE,
        failureCode: "needs_human_verification",
        auditAction: "submitting_quarantine_recovered",
        nowIso: new Date(now).toISOString(),
      });
      n++;
      continue;
    }

    if (!trip.robot_job_id) continue; // handled by recoverOrphanedSubmissions

    // Still being resolved automatically (read-only portal search / lost-job
    // confirmation window) — but only until the absolute ceiling.
    if (isActiveVerifyRobotStatus(robotStatus) && !exceededInFlightCeiling(started, now)) continue;
    if (!exceededInFlightCeiling(started, now)) continue;

    if (isActiveVerifyRobotStatus(robotStatus)) {
      // Ambiguous and out of time: hand to a human instead of holding a slot.
      await quarantineForHumanVerification(supabase, {
        recordId: r.id,
        tripId: trip.id ?? r.trip_id,
        actorId: null,
        message: INFLIGHT_CEILING_VERIFY_MESSAGE,
        failureCode: "inflight_ceiling_unverified",
        auditAction: "submitting_quarantine_recovered",
        nowIso: new Date(now).toISOString(),
      });
      n++;
      continue;
    }

    await routeToNeedsVerification(supabase, {
      recordId: r.id,
      tripId: trip.id,
      actorId: null,
      message: INFLIGHT_CEILING_VERIFY_MESSAGE,
      failureCode: "inflight_ceiling_unverified",
      auditAction: "submission_inflight_ceiling_needs_verification",
      nowIso: new Date(now).toISOString(),
    });
    n++;
  }
  return n;
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
  opts: {
    worker: string;
    companyId?: string | null;
    recordIds?: string[] | null;
    /** Fleet-aware override of the global cap (aggregate worker capacity). */
    globalLimit?: number | null;
  } = {
    worker: "worker",
  },
): Promise<SubmissionLease[]> {
  const { data, error } = await supabase.rpc("lease_submission_jobs", {
    _global_limit: Math.max(1, Math.floor(opts.globalLimit ?? maxSubmitGlobal())),
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
): Promise<"retry" | "failed" | "paced"> {
  const { id, attempt, error, actorId } = args;
  const nextAttempt = attempt + 1;
  const ambiguous = isAmbiguousSubmitError(error);
  const step1 = isPortalStep1ValidationFailure(error);
  const infra = isInfrastructureSubmitError(error);
  const transient = isTransientSubmitError(error) && !ambiguous && !step1;
  const canRetry = transient && nextAttempt < maxSubmitAttempts();
  // Diagnostics stay in `submit_last_error` / the audit log; the biller sees a
  // short sentence, never a Playwright stack trace.
  const userMsg = sanitizeSubmitError(error);
  const failure = classifySubmitFailure(error);

  // PRE-SUBMIT PACING — NOT A FAILURE.
  // The single-flight boundary (account already busy) and a browser that never
  // launched both happen strictly before any HCPF page exists, so no claim can
  // have been created. The bill goes straight back to `queued` with NO attempt
  // burnt and is never shown as a rejection. Idempotency key, account key and
  // tenant columns are untouched.
  if (!ambiguous && !step1 && isPreSubmitPacingCondition(error)) {
    const navFail = isPortalNavigationFailure(error);
    const busy = !navFail && isAccountBusyPreSubmitError(error);
    const fleetDown = !busy && isFleetUnavailable(error);
    const delayMs = busy ? SUBMIT_REFILL_POLL_MS : submitInfraCooldownMs();
    await supabase
      .from("billing_records")
      .update({
        status: "queued",
        // submit_attempt_count deliberately NOT incremented.
        submit_next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
        submit_heartbeat_at: null,
        submit_locked_until: null,
        submit_worker: null,
        submit_last_error: error.slice(0, 500),
        submission_error: navFail
          ? PORTAL_NAV_USER_MESSAGE
          : busy
            ? ACCOUNT_BUSY_USER_MESSAGE
            : fleetDown
              ? INFRA_USER_MESSAGE
              : LAUNCH_BUSY_USER_MESSAGE,
        requires_human_step: false,
        failure_stage: failure.stage,
        failure_code: navFail
          ? "portal_navigation"
          : busy
            ? "account_busy"
            : fleetDown
              ? "worker_unavailable"
              : "worker_capacity",
      })
      .eq("id", id);
    await logAudit(
      supabase,
      id,
      actorId,
      "submission_paced",
      navFail
        ? "The HCPF portal menu never rendered before the Claims step (pre-submit). Nothing was submitted; the bill stays queued and no attempt was consumed."
        : busy
        ? "Provider account was already running a portal session. Nothing was submitted; the bill stays queued and no attempt was consumed."
        : `Automation host had no capacity to launch a browser (pre-submit). Nothing was submitted; requeued in ${Math.round(delayMs / 1000)}s with no attempt consumed.`,
    );
    return "paced";
  }



  if (canRetry) {
    // A worker/browser failure means the whole worker is unhealthy, so wait out
    // a cooldown before that account slot is used again.
    const delay = infra
      ? Math.max(submitBackoffMs(attempt), submitInfraCooldownMs())
      : submitBackoffMs(attempt);
    await supabase
      .from("billing_records")
      .update({
        status: "queued",
        submit_attempt_count: nextAttempt,
        submit_next_attempt_at: new Date(Date.now() + delay).toISOString(),
        submit_heartbeat_at: null,
        submit_locked_until: null,
        submit_worker: null,
        submit_last_error: error.slice(0, 500),
        submission_error: userMsg,
        requires_human_step: false,
        failure_stage: failure.stage,
        failure_code: failure.code,
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
        submission_error: step1 ? PORTAL_STEP1_USER_MESSAGE : ambiguous ? AMBIGUOUS_USER_MESSAGE : userMsg,
        fix_notes: (step1 ? `${PORTAL_STEP1_USER_MESSAGE} ` : ambiguous ? `${AMBIGUOUS_USER_MESSAGE} ` : "") + error.slice(0, 400),
        requires_human_step: ambiguous || step1,
        failure_stage: failure.stage,
        failure_code: failure.code,
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
  opts: {
    companyId?: string | null;
    worker?: string;
    recordIds?: string[] | null;
    /** Robot mode; queued work is a one-shot "full" submission by default. */
    mode?: "capture" | "submit" | "full" | "debug_confirm_page";
  } = {},
): Promise<{
  leased: number;
  started: number;
  paced: number;
  retried: number;
  failed: number;
  /** Retries stopped because the bill may already exist at the portal. */
  blocked: number;
  startedIds: string[];
  globalLimit?: number;
}> {

  const worker = opts.worker ?? `w-${Math.random().toString(36).slice(2, 10)}`;

  // FLEET-AWARE GLOBAL CAP. With one worker this is exactly today's
  // SUBMIT_MAX_GLOBAL; with several healthy workers it grows to the aggregate
  // capacity, under a hard ceiling. A dead/disabled fleet leases nothing.
  const fleet = await loadFleet(supabase);
  const globalLimit = effectiveGlobalLimit(fleet, maxSubmitGlobal());
  if (globalLimit <= 0) {
    return {
      leased: 0,
      started: 0,
      paced: 0,
      retried: 0,
      failed: 0,
      blocked: 0,
      startedIds: [],
      globalLimit: 0,
    };
  }

  const leases = await leaseSubmissionJobs(supabase, {
    worker,
    companyId: opts.companyId ?? null,
    recordIds: opts.recordIds ?? null,
    globalLimit,
  });
  if (leases.length === 0) {
    return {
      leased: 0,
      started: 0,
      paced: 0,
      retried: 0,
      failed: 0,
      blocked: 0,
      startedIds: [],
      globalLimit,
    };
  }



  // Same-passenger pacing: the portal chokes when several sessions touch one
  // member at once. Live counts come from the DB, not memory.
  const active = await listActiveRobotJobs(supabase, { companyId: opts.companyId ?? null });
  const riderLive = new Map<string, number>();
  for (const a of active) {
    if (!a.riderKey) continue;
    riderLive.set(a.riderKey, (riderLive.get(a.riderKey) ?? 0) + 1);
  }

  // One fleet/load snapshot for the whole batch — routing is then O(1)/bill.
  const { loadWorkerActiveCounts } = await import("@/lib/robotFleet.server");
  const fleetContext = { fleet, load: await loadWorkerActiveCounts(supabase) };

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
  let blocked = 0;
  const dispatchable: Array<{ lease: SubmissionLease; rec: any }> = [];

  for (const lease of leases) {
    const rec = byId.get(lease.id);
    if (!rec) {
      await releaseLease(supabase, lease.id);
      continue;
    }

    // RECONCILE BEFORE ANY RETRY.
    // A bill that already failed once (timeout / closed browser / worker error)
    // is only retried when the database shows no sign that a claim exists. Any
    // evidence at all → awaiting verification, never an automatic resubmit.
    const isRetry =
      Number(rec.submit_attempt_count ?? lease.attempt ?? 0) > 0 || Boolean(rec.submit_last_error);
    if (isRetry && hasPortalClaimEvidence(rec)) {
      await parkForVerification(supabase, {
        id: rec.id,
        actorId,
        detail:
          "A previous attempt left portal claim evidence in our records, so this bill was not retried. Verify it at the portal before resubmitting.",
      });
      blocked++;
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
        .update({
          status: "submitting",
          submission_error: null,
          requires_human_step: false,
          submit_heartbeat_at: new Date().toISOString(),
          failure_stage: null,
          failure_code: null,
        })
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
          // Queued work is a real one-shot submission unless a caller (the
          // legacy two-pass confirm) explicitly asks for another mode.
          mode: opts.mode ?? "full",
          // Tenant used only to pick a robot worker; payload is untouched.
          companyId: rec.company_id ?? rec.medicaid_trips?.company_id ?? null,
          fleetContext,
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
        else if (outcome === "paced") paced++; // pre-submit pacing: stays queued
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
    blocked,
    startedIds,
    globalLimit,
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
  opts: {
    actorId?: string | null;
    companyId?: string | null;
    worker?: string;
    /**
     * Keep reconciling + refilling freed account slots inside this
     * tick (used by the background cron). Off by default so a UI-triggered
     * kick still returns immediately.
     */
    refill?: boolean;
    refillPollMs?: number;
    refillMaxRounds?: number;
  } = {},
): Promise<QueueTickResult> {

  const t0 = Date.now();
  const base: QueueTickResult = {
    ok: true,
    ran: false,
    leased: 0,
    started: 0,
    paced: 0,
    blocked: 0,
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
  const recovered =
    (await recoverOrphanedSubmissions(supabase, opts.companyId ?? null)) +
    (await recoverStuckInFlightSubmissions(supabase, opts.companyId ?? null));

  // Read-only fleet liveness. Only meaningful with a real multi-worker fleet,
  // and it never touches HCPF — just the automation service's own /health.
  try {
    const declared = await loadFleet(supabase);
    if (declared.length > 1) {
      const { probeFleet } = await import("@/lib/robotFleet.server");
      await probeFleet(supabase);
    }
  } catch {
    /* health probing must never break a tick */
  }

  // Reconciliation stays on the proven path so claim ids/statuses populate
  // exactly as today and feed the read-only status-check queue.
  const { reconcileInFlight } = await import("@/lib/robotQueue.server");
  const reconciled = await reconcileInFlight(
    supabase,
    opts.actorId ?? null,
    opts.companyId ?? null,
  );

  // SAFETY NET: release anything an older build parked behind a wave gate, so
  // queued work can never sit invisible.
  try {
    const { promoteDueWaves } = await import("@/lib/submissionWaves.server");
    await promoteDueWaves(supabase, { companyId: opts.companyId ?? null });
  } catch {
    /* best effort */
  }

  // AUTO PILOT. If a run is active, top its wave up with the next eligible
  // bills through the normal safe submit path. This is what makes "press once
  // and walk away" work without a browser open.
  try {
    const { feedAutoPilot } = await import("@/lib/autoPilot.server");
    await feedAutoPilot(supabase, {
      companyId: opts.companyId ?? null,
      userId: opts.actorId ?? null,
    });
  } catch {
    /* a feeding hiccup must never break a tick; the next one retries */
  }


  const budget = SUBMIT_RUN_BUDGET_MS();
  let dispatch = {
    leased: 0,
    started: 0,
    paced: 0,
    retried: 0,
    failed: 0,
    blocked: 0,
    startedIds: [] as string[],
  };
  if (Date.now() - t0 < budget) {
    dispatch = await dispatchLeasedSubmissions(supabase, opts.actorId ?? null, {
      companyId: opts.companyId ?? null,
      worker: opts.worker ?? `tick-${t0}`,
    });
  }

  // IMMEDIATE REFILL AFTER A SUCCESS.
  // A finished claim frees an account slot right away, so the
  // tick keeps re-reconciling and re-dispatching while its budget lasts instead
  // of leaving the slot idle until the next cron minute. There is deliberately
  // NO success cooldown here — backoff only ever comes from a real worker or
  // transport failure inside `scheduleRetryOrFail`.
  let totals = { ...reconciled };
  const pollMs = Math.max(250, opts.refillPollMs ?? SUBMIT_REFILL_POLL_MS);
  const maxRounds = opts.refill === false ? 0 : (opts.refillMaxRounds ?? (opts.refill ? SUBMIT_REFILL_MAX_ROUNDS : 0));
  let rounds = 0;
  while (rounds < maxRounds && Date.now() - t0 + pollMs < budget) {
    rounds++;
    await sleep(pollMs);
    const again = await reconcileInFlight(supabase, opts.actorId ?? null, opts.companyId ?? null);
    totals = { checked: totals.checked + again.checked, settled: totals.settled + again.settled };
    // Nothing left in flight AND nothing settled → the lane is idle, stop early.
    if (again.checked === 0 && again.settled === 0) break;
    if (again.settled <= 0) continue;

    // A settled bill may have completed a wave slot — release the next one.
    try {
      const { promoteDueWaves } = await import("@/lib/submissionWaves.server");
      await promoteDueWaves(supabase, { companyId: opts.companyId ?? null });
    } catch {
      /* best effort */
    }

    const more = await dispatchLeasedSubmissions(supabase, opts.actorId ?? null, {
      companyId: opts.companyId ?? null,
      worker: opts.worker ?? `tick-${t0}-r${rounds}`,
    });
    dispatch = {
      leased: dispatch.leased + more.leased,
      started: dispatch.started + more.started,
      paced: dispatch.paced + more.paced,
      retried: dispatch.retried + more.retried,
      failed: dispatch.failed + more.failed,
      blocked: dispatch.blocked + more.blocked,
      startedIds: [...dispatch.startedIds, ...more.startedIds],
    };
  }

  const out: QueueTickResult = {
    ...base,
    ran: true,
    ...dispatch,
    recovered,
    staleLocksReleased,
    checked: totals.checked,
    settled: totals.settled,
    ms: Date.now() - t0,
  };

  await recordRun(supabase, out);
  return out;
}
