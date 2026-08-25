/**
 * AUTOMATIC TIMEOUT RETRY.
 *
 * When the reconciler settles a job as a pure portal TIMEOUT (nothing was
 * submitted, the data is fine), the bill is put straight back into the normal
 * submission queue instead of parking in "Needs fix" until a human notices.
 *
 * Rules:
 *  - only timeouts (see looksLikeRetryableTimeout) — never data-validation errors
 *  - at most MAX_AUTO_TIMEOUT_RETRIES automatic attempts per bill
 *  - the retry is a plain `queued` row, so it obeys the exact same global
 *    concurrency and same-passenger pacing rules as any other submission
 *  - every attempt is written to the audit trail
 */
import { logAudit, MAX_AUTO_TIMEOUT_RETRIES, looksLikeRetryableTimeout } from "@/lib/billingHelpers";

export type AutoRetryOutcome =
  | { retried: true; attempt: number; message: string }
  | { retried: false; exhausted: boolean; message: string | null };

export async function maybeAutoRetryTimeout(
  supabase: any,
  recordId: string,
  tripId: string,
  errMsg: string,
  actorId: string | null,
): Promise<AutoRetryOutcome> {
  if (!looksLikeRetryableTimeout(errMsg)) {
    return { retried: false, exhausted: false, message: null };
  }

  const { data: rec } = await supabase
    .from("billing_records")
    .select("id, auto_retry_count, state_confirmation_number, medicaid_trips(robot_confirmation_number, submitted_confirmation, robot_last_status, portal_status, status)")
    .eq("id", recordId)
    .maybeSingle();
  const tripEvidence: any = rec?.medicaid_trips ?? {};
  const hasClaimEvidence = Boolean(
    rec?.state_confirmation_number ||
      tripEvidence.robot_confirmation_number ||
      tripEvidence.submitted_confirmation ||
      /^SUBMITTED/i.test(String(tripEvidence.robot_last_status ?? "")) ||
      /submitted|paid|approved|suspended|denied/i.test(String(tripEvidence.portal_status ?? "")) ||
      String(tripEvidence.status ?? "") === "submitted",
  );
  if (hasClaimEvidence) {
    const message =
      "A timeout arrived after claim evidence was already recorded. Nothing was retried or downgraded.";
    await logAudit(supabase, recordId, actorId, "auto_retry_skipped_claim_evidence", message);
    return { retried: false, exhausted: false, message };
  }
  const used: number = Number(rec?.auto_retry_count ?? 0);

  if (used >= MAX_AUTO_TIMEOUT_RETRIES) {
    const message = `Timed out ${MAX_AUTO_TIMEOUT_RETRIES + 1} times — may need manual review. Last portal error: ${errMsg.slice(0, 300)}`;
    await supabase
      .from("medicaid_trips")
      .update({
        robot_last_status: "TIMED_OUT_RETRIES_EXHAUSTED",
        robot_last_message: message,
        robot_last_checked_at: new Date().toISOString(),
      })
      .eq("id", tripId);
    await supabase
      .from("billing_records")
      .update({
        status: "needs_fix",
        submission_error: message,
        fix_notes: message,
        requires_human_step: false,
      })
      .eq("id", recordId);
    await logAudit(supabase, recordId, actorId, "auto_retry_exhausted", message);
    return { retried: false, exhausted: true, message };
  }

  const attempt = used + 1;
  const message = `Portal timed out — automatic retry ${attempt} of ${MAX_AUTO_TIMEOUT_RETRIES} queued. Portal detail: ${errMsg.slice(0, 200)}`;
  await supabase
    .from("medicaid_trips")
    .update({
      robot_job_id: null,
      robot_job_started_at: null,
      robot_last_status: "AUTO_RETRY_QUEUED",
      robot_last_message: message,
      robot_last_checked_at: new Date().toISOString(),
    })
    .eq("id", tripId);
  await supabase
    .from("billing_records")
    .update({
      status: "queued",
      auto_retry_count: attempt,
      submission_error: message,
      fix_notes: null,
      requires_human_step: false,
    })
    .eq("id", recordId);
  await logAudit(supabase, recordId, actorId, "auto_retry_timeout", message);
  return { retried: true, attempt, message };
}
