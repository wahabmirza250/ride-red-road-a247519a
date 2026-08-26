/**
 * LOST / ORPHANED ROBOT JOB HANDLING (server).
 *
 * One shared writer used by the interactive poll, the background sweep and the
 * queue tick so an ambiguous "the job is gone" outcome is always classified the
 * same way: Needs Verification, never an automatic retry.
 *
 * Evidence is preserved: the robot job id, idempotency key, account key,
 * batch id, attempt counters and timestamps are never cleared or overwritten.
 * Only the worker LEASE is released, because the lease is app state, not
 * portal evidence.
 */
import { logAudit, UNVERIFIED_SUBMIT_STATUS } from "@/lib/billingHelpers";
import {
  JOB_NOT_FOUND_STATUS,
  LOST_JOB_FIRST_SEEN_MESSAGE,
  LOST_JOB_VERIFY_MESSAGE,
  lostJobDecision,
} from "@/lib/robotJobLost";

export type LostJobOutcome = {
  pending: boolean;
  status: string;
  message: string;
};

/** Record the FIRST time a started job answered "not found". No classification yet. */
export async function markRobotJobNotFound(
  supabase: any,
  args: { recordId: string; tripId: string; actorId: string | null; nowIso?: string },
): Promise<LostJobOutcome> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  await supabase
    .from("medicaid_trips")
    .update({
      robot_last_status: JOB_NOT_FOUND_STATUS,
      robot_last_message: LOST_JOB_FIRST_SEEN_MESSAGE,
      robot_last_checked_at: nowIso,
    })
    .eq("id", args.tripId);
  await logAudit(
    supabase,
    args.recordId,
    args.actorId,
    "robot_job_not_found",
    LOST_JOB_FIRST_SEEN_MESSAGE,
  );
  return { pending: true, status: JOB_NOT_FOUND_STATUS, message: LOST_JOB_FIRST_SEEN_MESSAGE };
}

/**
 * Route an ambiguous in-flight bill to Needs Verification.
 *
 * The bill stays in `submitting` so the existing read-only portal claim search
 * keeps running (bounded — it ends at NEEDS_HUMAN_LOOKUP), and
 * `requires_human_step` makes the Billing UI show "Needs verification".
 */
export async function routeToNeedsVerification(
  supabase: any,
  args: {
    recordId: string;
    tripId: string;
    actorId: string | null;
    message: string;
    failureCode: string;
    auditAction?: string;
    nowIso?: string;
  },
): Promise<LostJobOutcome> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  await supabase
    .from("medicaid_trips")
    .update({
      robot_last_status: UNVERIFIED_SUBMIT_STATUS,
      robot_last_message: args.message,
      robot_last_checked_at: nowIso,
    })
    .eq("id", args.tripId);
  await supabase
    .from("billing_records")
    .update({
      // Stays in flight: the read-only claim search owns it from here.
      status: "submitting",
      requires_human_step: true,
      submission_error: args.message,
      submit_last_error: args.message,
      failure_stage: "worker",
      failure_code: args.failureCode,
      // Release only the app-side lease; all portal evidence is preserved.
      submit_locked_until: null,
      submit_worker: null,
      submit_next_attempt_at: null,
    })
    .eq("id", args.recordId);
  await logAudit(
    supabase,
    args.recordId,
    args.actorId,
    args.auditAction ?? "robot_job_lost_needs_verification",
    args.message,
  );
  return { pending: false, status: UNVERIFIED_SUBMIT_STATUS, message: args.message };
}

/**
 * Full handling of a `/job-status/<id>` 404 for a job we really started.
 * Bounded confirmation window, then Needs Verification. Never a retry.
 */
export async function handleLostRobotJob(
  supabase: any,
  args: {
    recordId: string;
    tripId: string;
    actorId: string | null;
    /** `robot_last_status` currently on the trip. */
    robotLastStatus: string | null | undefined;
    /** `robot_last_checked_at` — first-seen time once the marker is set. */
    robotLastCheckedAt: string | null | undefined;
    now?: number;
  },
): Promise<LostJobOutcome> {
  const now = args.now ?? Date.now();
  const alreadyMarked = args.robotLastStatus === JOB_NOT_FOUND_STATUS;
  if (!alreadyMarked) {
    return await markRobotJobNotFound(supabase, {
      recordId: args.recordId,
      tripId: args.tripId,
      actorId: args.actorId,
      nowIso: new Date(now).toISOString(),
    });
  }

  if (lostJobDecision({ firstSeenAt: args.robotLastCheckedAt ?? null, now }) === "wait") {
    // Deliberately no write: overwriting robot_last_checked_at here would reset
    // the confirmation window and the bill could wait forever.
    return { pending: true, status: JOB_NOT_FOUND_STATUS, message: LOST_JOB_FIRST_SEEN_MESSAGE };
  }

  return await routeToNeedsVerification(supabase, {
    recordId: args.recordId,
    tripId: args.tripId,
    actorId: args.actorId,
    message: LOST_JOB_VERIFY_MESSAGE,
    failureCode: "job_lost_unverified",
    nowIso: new Date(now).toISOString(),
  });
}
