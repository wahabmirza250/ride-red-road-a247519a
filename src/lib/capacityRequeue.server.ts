/**
 * PRE-SUBMIT CAPACITY REQUEUE (server writer).
 *
 * A worker that could not even start a browser (spawn EAGAIN, pthread_create,
 * failed to launch zygote, newPage/newContext target closed) never reached the
 * HCPF portal, so no claim can exist. That is a CAPACITY condition, not a
 * submission failure and never a data problem:
 *
 *   - the bill returns to `queued` (Ready to Submit → picked up by a healthy
 *     worker) instead of `needs_fix`
 *   - NO attempt is consumed
 *   - only the worker lease is released; robot job id, idempotency key,
 *     account key, attempt counters and the audit trail are preserved
 *
 * It is only ever applied when the caller has already excluded ambiguity
 * (Submit/Confirm timeouts, SUBMITTED_UNVERIFIED, NEEDS_HUMAN_LOOKUP, any real
 * claim evidence) via `isPreSubmitPacingCondition`.
 */
import { logAudit } from "@/lib/billingHelpers";
import { LAUNCH_BUSY_USER_MESSAGE } from "@/lib/submitErrors";

export const CAPACITY_ROBOT_STATUS = "WORKER_CAPACITY";

export async function requeueForWorkerCapacity(
  supabase: any,
  args: {
    recordId: string;
    tripId?: string | null;
    actorId: string | null;
    /** Raw worker diagnostics — kept internal, never shown to a biller. */
    detail: string;
    /** Cooldown before this bill may be leased again. */
    delayMs?: number;
    nowIso?: string;
  },
): Promise<{ pending: boolean; status: string; message: string }> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const delayMs = args.delayMs ?? 60_000;

  if (args.tripId) {
    await supabase
      .from("medicaid_trips")
      .update({
        // The job is over, but nothing was submitted: clear the job pointer so
        // the poll stops chasing it. Confirmation fields are never touched.
        robot_job_id: null,
        robot_job_started_at: null,
        robot_last_status: CAPACITY_ROBOT_STATUS,
        robot_last_message: LAUNCH_BUSY_USER_MESSAGE,
        robot_last_checked_at: nowIso,
      })
      .eq("id", args.tripId);
  }

  await supabase
    .from("billing_records")
    .update({
      status: "queued",
      // submit_attempt_count deliberately NOT incremented.
      requires_human_step: false,
      submission_error: LAUNCH_BUSY_USER_MESSAGE,
      fix_notes: null,
      submit_last_error: args.detail.slice(0, 500),
      failure_stage: "dispatch",
      failure_code: "worker_capacity",
      submit_next_attempt_at: new Date(Date.parse(nowIso) + delayMs).toISOString(),
      submit_heartbeat_at: null,
      submit_locked_until: null,
      submit_worker: null,
    })
    .eq("id", args.recordId);

  await logAudit(
    supabase,
    args.recordId,
    args.actorId,
    "submission_worker_capacity_requeued",
    `Automation host had no capacity to start a browser (pre-submit). Nothing was submitted; ` +
      `requeued in ${Math.round(delayMs / 1000)}s with no attempt consumed. Detail: ${args.detail.slice(0, 300)}`,
  );

  return { pending: true, status: CAPACITY_ROBOT_STATUS, message: LAUNCH_BUSY_USER_MESSAGE };
}
