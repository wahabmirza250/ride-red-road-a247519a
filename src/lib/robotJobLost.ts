/**
 * LOST / ORPHANED ROBOT JOB CLASSIFICATION (pure).
 *
 * The automation service keeps job state in memory. A Railway restart or
 * redeploy therefore erases job ids, and RedArt's `/job-status/<id>` poll then
 * answers 404 forever while the bill sits in `submitting`.
 *
 * A lost job proves NOTHING about whether HCPF received the claim, so it is
 * ambiguous by definition: it may never be automatically retried. After a short
 * bounded confirmation window (the job could simply be starting up / the worker
 * could be briefly redeploying) the bill is routed to Needs Verification, where
 * the existing READ-ONLY portal claim search resolves it.
 *
 * Pure functions only — no data access, no side effects.
 */

/** Marker written to `medicaid_trips.robot_last_status` on the first 404. */
export const JOB_NOT_FOUND_STATUS = "JOB_NOT_FOUND";

/**
 * How long a job may answer "not found" before the bill is classified.
 * Short enough that nothing sits silently, long enough to survive one
 * Railway redeploy / cold start.
 */
export const LOST_JOB_CONFIRM_WINDOW_MS = 120_000;

/**
 * Absolute ceiling for a bill in `submitting`. Past this, even without a poll
 * answer, the bill is classified (never retried) so it can never sit forever.
 */
export const INFLIGHT_HARD_CEILING_MS = 30 * 60_000;

/** A claim taking longer than this is flagged as slow in the Processing view. */
export const SLOW_CLAIM_WARN_MS = 8 * 60_000;

/** Does this poll answer mean "the automation service has no such job"? */
export function isJobNotFoundResponse(
  httpStatus: number,
  body?: string | null,
): boolean {
  if (httpStatus === 404 || httpStatus === 410) return true;
  const t = String(body ?? "");
  if (!t) return false;
  return /job (?:not found|unknown|expired)|unknown job|no such job|not_found/i.test(t);
}

/**
 * Bounded confirmation window. `wait` keeps polling without touching state;
 * `verify` routes the bill to Needs Verification (never a retry).
 */
export function lostJobDecision(input: {
  firstSeenAt: string | number | null | undefined;
  now?: number;
}): "wait" | "verify" {
  const now = input.now ?? Date.now();
  if (input.firstSeenAt == null) return "wait";
  const t =
    typeof input.firstSeenAt === "number"
      ? input.firstSeenAt
      : Date.parse(String(input.firstSeenAt));
  if (!Number.isFinite(t)) return "wait";
  return now - t >= LOST_JOB_CONFIRM_WINDOW_MS ? "verify" : "wait";
}

/** Has an in-flight bill blown through the absolute ceiling? */
export function exceededInFlightCeiling(
  startedAt: string | number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (startedAt == null) return false;
  const t = typeof startedAt === "number" ? startedAt : Date.parse(String(startedAt));
  if (!Number.isFinite(t)) return false;
  return now - t >= INFLIGHT_HARD_CEILING_MS;
}

export const LOST_JOB_FIRST_SEEN_MESSAGE =
  "The automation service no longer knows about this job (it was most likely " +
  "restarted). Checking again for a couple of minutes before deciding — nothing " +
  "is being resubmitted.";

export const LOST_JOB_VERIFY_MESSAGE =
  "The automation job was lost (the service restarted), so it is unknown whether " +
  "the claim reached HCPF. This bill was NOT retried. An automatic read-only " +
  "portal search will look for the claim — do NOT resubmit until it is verified.";

export const INFLIGHT_CEILING_VERIFY_MESSAGE =
  "This submission never reported a final result and has exceeded the maximum " +
  "processing time. It was NOT retried, because a claim may already exist at " +
  "HCPF. An automatic read-only portal search will verify it — do NOT resubmit.";
