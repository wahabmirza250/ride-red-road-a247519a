/**
 * SHARED ROBOT RECONCILIATION.
 *
 * Polls the Railway automation service for one billing record's job and writes
 * the real outcome back to the trip + billing record. Extracted out of
 * `billing.functions.ts` so the interactive poll, the background sweep and the
 * cron endpoint all reconcile identically.
 */
import {
  logAudit,
  ROBOT_BASE_URL,
  looksLikePossiblySubmittedTimeout,
  looksLikePostConfirmTimeout,
  looksLikeNoServiceLinesFailure,
  UNVERIFIED_SUBMIT_STATUS,
} from "@/lib/billingHelpers";
import { extractConfirmationNumber, normalizeCapturedClaim } from "@/lib/claimReview";
import { isPortalStep1ValidationFailure, PORTAL_STEP1_USER_MESSAGE } from "@/lib/submitErrors";

export type ReconcileResult = {
  pending: boolean;
  status: string;
  message: string | null;
  confirmation_number?: string | null;
};

export async function reconcileRobotJob(
  supabase: any,
  recordId: string,
  actorId: string | null,
): Promise<ReconcileResult> {
  const data = { id: recordId };
  const userId = actorId;

  const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id, state_confirmation_number,
         medicaid_trips!inner(id, robot_job_id, robot_worker_id, robot_worker_url, robot_pass, robot_last_status, robot_last_message, robot_last_checked_at, status, submitted_confirmation, robot_confirmation_number)`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const trip: any = rec.medicaid_trips;

    // Already reconciled/submitted: a stale robot job result must never be
    // allowed to downgrade a trip that has a real portal confirmation number.
    // An acknowledged resubmission (robot_pass = "resubmit") is polled normally
    // so its new claim number can be recorded.
    const knownConfirmation: string | null =
      trip?.robot_confirmation_number ?? trip?.submitted_confirmation ?? null;
    const billingConfirmation: string | null = (rec as any)?.state_confirmation_number ?? null;
    if ((knownConfirmation || billingConfirmation) && trip?.robot_pass !== "resubmit") {
      const confirmation = knownConfirmation ?? billingConfirmation;

      return {
        pending: false,
        status: "submitted",
        message: `Already submitted — portal confirmation #${confirmation}`,
        confirmation_number: confirmation,
      };
    }

    // Confirm was clicked but the page timed out on a previous poll. Re-polling
    // the job would just replay the same timeout, so run the read-only portal
    // claim search instead until the real claim number is found.
    if (trip?.robot_last_status === UNVERIFIED_SUBMIT_STATUS) {
      const { resolveUnverifiedClaim } = await import("@/lib/unverifiedClaim.server");
      return await resolveUnverifiedClaim(supabase, rec.id, userId);
    }
    if (trip?.robot_last_status === "NEEDS_HUMAN_LOOKUP") {
      return {
        pending: false,
        status: "NEEDS_HUMAN_LOOKUP",
        message: trip?.robot_last_message ?? "Needs a manual portal claim lookup.",
      };
    }

    const jobId: string | null = trip?.robot_job_id ?? null;
    if (!jobId) {
      return { pending: false, status: "no_job", message: "No robot job has been started for this trip." };
    }

    // STICKY POLLING: always ask the worker that accepted this job. Robot jobs
    // are memory-backed per process, so polling any other worker would look
    // like "job not found" and could trigger a duplicate submission.
    const { pollBaseUrlFor } = await import("@/lib/robotFleet.server");
    const pollBase = pollBaseUrlFor(trip);
    const res = await fetch(`${pollBase}/job-status/${encodeURIComponent(jobId)}`, {
      method: "GET",
    });
    const text = await res.text();
    if (!res.ok) {
      // Don't mutate DB state on a transient poll failure
      return {
        pending: true,
        status: "poll_error",
        message: `Poll failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    let body: any = {};
    try { body = JSON.parse(text); } catch { /* ignore */ }

    const jobStatus: string = String(body?.status ?? "unknown");
    const result = body?.result ?? {};
    const resultStatus: string = String(result?.status ?? "");
    const resultReason: string | null =
      typeof result?.reason === "string" && result.reason ? result.reason :
      typeof result?.message === "string" && result.message ? result.message :
      typeof result?.error === "string" && result.error ? result.error :
      typeof body?.error === "string" && body.error ? body.error : null;

    const nowIso = new Date().toISOString();

    // Still running
    if (jobStatus !== "done" && jobStatus !== "error") {
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: jobStatus,
          robot_last_message: resultReason,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      return { pending: true, status: jobStatus, message: resultReason };
    }

    // Only an explicit capture run is a capture. "submit", "resubmit" and the
    // one-shot "full" runs all really click Submit, so they must never fall
    // into the legacy "captured — please review this too" branch below.
    const pass: "capture" | "submit" = trip?.robot_pass === "capture" ? "capture" : "submit";

    // Terminal: PASS 2 finished — the robot really clicked Submit + Confirm.
    if (jobStatus === "done" && pass === "submit") {
      const confirmation = extractConfirmationNumber(result) ?? extractConfirmationNumber(body);
      const submitted =
        !!confirmation ||
        ["SUBMITTED", "CONFIRMED", "SUCCESS", "COMPLETED"].includes(resultStatus.toUpperCase());

      if (submitted) {
        await supabase
          .from("medicaid_trips")
          .update({
            robot_last_status: resultStatus || "SUBMITTED",
            robot_last_message: confirmation
              ? `Submitted. Portal confirmation #${confirmation}`
              : "Submitted to the portal.",
            robot_last_checked_at: nowIso,
            robot_confirmation_number: confirmation,
            // Canonical submission record — kept in sync so the trip row itself
            // reflects the real portal submission without manual correction.
            status: "submitted",
            submitted_confirmation: confirmation,
            portal_confirmation: confirmation,
            portal_status: "submitted",
            portal_submitted_at: nowIso,
            submitted_at: nowIso,
            submitted_by: userId,
          })
          .eq("id", trip.id);

        await supabase
          .from("billing_records")
          .update({
            status: "submitted",
            state_confirmation_number: confirmation,
            submitted_at: nowIso,
            submission_error: null,
            requires_human_step: false,
            // Enqueue automatic read-only portal status checking right away.
            status_check_next_at: confirmation ? nowIso : null,
            status_check_attempts: 0,
            status_check_error: null,
          })
          .eq("id", rec.id);
        await logAudit(
          supabase,
          rec.id,
          userId,
          "robot_submitted",
          confirmation ? `Confirmation #${confirmation}` : "Submitted (no confirmation number returned)",
        );
        return {
          pending: false,
          status: "submitted",
          message: confirmation
            ? `Submitted — confirmation #${confirmation}`
            : "Submitted, but the portal did not return a confirmation number.",
          confirmation_number: confirmation,
        };
      }

      // Pass 2 did NOT complete — never silently mark as submitted.
      const failMsg =
        resultReason ||
        `The real submission did not complete (portal returned "${resultStatus || jobStatus}"). The claim was NOT submitted.`;
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: resultStatus || jobStatus,
          robot_last_message: failMsg,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "pending_submit",
          requires_human_step: true,
          submission_error: failMsg,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_submit_failed", failMsg);
      return { pending: false, status: resultStatus || jobStatus, message: failMsg };
    }

    // Terminal: one-shot full job really submitted and confirmed at the portal.
    if (jobStatus === "done" && resultStatus === "SUBMITTED") {
      // Keep any claim data the robot happened to read back, so Claims History
      // and Earnings have the portal's own total when it is available.
      const capturedOnSubmit = normalizeCapturedClaim(result) ?? normalizeCapturedClaim(body);
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: resultStatus,
          robot_last_message: result.message ?? null,
          robot_last_checked_at: nowIso,
          ...(capturedOnSubmit
            ? { robot_captured_claim: capturedOnSubmit, robot_captured_at: nowIso }
            : {}),
        })
        .eq("id", trip.id);

      await supabase
        .from("billing_records")
        .update({
          status: "submitted",
          state_confirmation_number: result.claim_id ?? null,
          submitted_at: nowIso,
          submission_error: null,
          requires_human_step: false,
          // Enqueue automatic read-only portal status checking right away.
          status_check_next_at: result.claim_id ? nowIso : null,
          status_check_attempts: 0,
          status_check_error: null,
        })
        .eq("id", rec.id);
      await logAudit(
        supabase,
        rec.id,
        userId,
        "robot_submitted",
        result.claim_id ? `Claim ID: ${result.claim_id}` : (result.message ?? null),
      );
      return { pending: false, status: resultStatus, message: result.message ?? null };
    }

    // Terminal: PASS 1 finished — the claim was filled and read back, session closed.
    // ONLY an explicit capture-only run may land here. A one-shot "full"/submit
    // run that reports READY_FOR_HUMAN_REVIEW means the robot stopped BEFORE
    // clicking Submit: nothing was sent, so it is a plain retryable failure —
    // never a second "please review this too" checkpoint.
    const isFailureStatus =
      typeof resultStatus === "string" &&
      /^(BLOCKED|ERROR|FAILED|PORTAL_)/i.test(resultStatus);
    if (jobStatus === "done" && !isFailureStatus && pass === "capture") {

      const captured = normalizeCapturedClaim(result) ?? normalizeCapturedClaim(body);
      const msg = captured
        ? "Claim data captured from the portal — review it below, then Confirm & Submit."
        : "The robot filled the claim but did not return readable claim data. Review in the portal before submitting.";
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: resultStatus || "CAPTURED",
          robot_last_message: msg,
          robot_last_checked_at: nowIso,
          robot_captured_claim: captured ?? null,
          robot_captured_at: captured ? nowIso : null,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "pending_submit",
          requires_human_step: true,
          submission_error: msg,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_captured_for_review", msg);
      return { pending: false, status: resultStatus || "CAPTURED", message: msg };
    }

    // One-shot run that stopped at the review point without submitting.
    if (jobStatus === "done" && !isFailureStatus && resultStatus === "READY_FOR_HUMAN_REVIEW") {
      const stopped =
        "The robot filled the claim but stopped before clicking Submit, so nothing " +
        "was sent to the portal. No claim was created — retry the submission.";
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: "STOPPED_BEFORE_SUBMIT",
          robot_last_message: stopped,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "needs_fix",
          submission_error: stopped,
          fix_notes: stopped,
          requires_human_step: false,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_stopped_before_submit", stopped);
      return { pending: false, status: "STOPPED_BEFORE_SUBMIT", message: stopped };
    }



    // Terminal: error / BLOCKED_*
    const errMsg =
      resultReason ||
      (resultStatus ? `Automation returned ${resultStatus}` : "Automation failed");

    // DEFINITELY-NOT-SUBMITTED: the portal refused Step 3 because no service
    // line was committed (or the pre-Submit guard aborted the run). No claim
    // was created, so this stays a plain retryable failure with a message that
    // says so — never the possibly-submitted state below.
    if (looksLikeNoServiceLinesFailure(errMsg)) {
      const clear =
        "No claim was created. The portal rejected the claim because no service " +
        "line was committed (the trip/base and mileage lines did not save). " +
        "Nothing was submitted — this trip can safely be retried. " +
        `Portal detail: ${errMsg.slice(0, 300)}`;
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: resultStatus || jobStatus || "NO_SERVICE_LINES",
          robot_last_message: clear,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "needs_fix",
          submission_error: clear,
          fix_notes: clear,
          requires_human_step: false,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_failed_no_service_lines", clear);
      return { pending: false, status: resultStatus || "NO_SERVICE_LINES", message: clear };
    }

    if (isPortalStep1ValidationFailure(errMsg)) {
      const clear = `${PORTAL_STEP1_USER_MESSAGE} Internal detail: ${errMsg.slice(0, 300)}`;
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: "PORTAL_STEP1_VALIDATION_FAILED",
          robot_last_message: PORTAL_STEP1_USER_MESSAGE,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "needs_fix",
          submission_error: PORTAL_STEP1_USER_MESSAGE,
          fix_notes: clear,
          requires_human_step: true,
          submit_next_attempt_at: null,
          submit_locked_until: null,
          submit_worker: null,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_step1_validation_failed", clear);
      return { pending: false, status: "PORTAL_STEP1_VALIDATION_FAILED", message: PORTAL_STEP1_USER_MESSAGE };
    }

    // FALSE-FAILURE GUARD: the Confirm click landed and only the navigation
    // wait timed out. The claim is very likely live at the portal, so this must
    // NEVER go back into a retryable state — that would double-submit.
    if (pass === "submit" && (looksLikePostConfirmTimeout(errMsg) || looksLikePossiblySubmittedTimeout(errMsg))) {
      const warn =
        "The automation reached the portal Submit/Confirm area, then timed out or the browser closed. " +
        "A claim may already exist. An automatic read-only portal search will now run every few " +
        "minutes to find the real claim number — do NOT resubmit.";
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: UNVERIFIED_SUBMIT_STATUS,
          robot_last_message: warn,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "submitting",
          submission_error: warn,
          requires_human_step: false,
          submit_next_attempt_at: null,
          submit_locked_until: null,
          submit_worker: null,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_submit_unverified", `${warn} :: ${errMsg.slice(0, 500)}`);
      // Non-terminal: the sweep keeps checking until the claim is found or a
      // human is flagged after the retry budget runs out.
      return { pending: true, status: UNVERIFIED_SUBMIT_STATUS, message: warn };
    }


    // TRANSIENT TIMEOUT: nothing was submitted and the data is fine, so put the
    // bill straight back into the normal queue (same concurrency + same-passenger
    // pacing rules) instead of parking it for a human. Capped, and audited.
    const { maybeAutoRetryTimeout } = await import("@/lib/autoRetry.server");
    const auto = await maybeAutoRetryTimeout(supabase, rec.id, trip.id, errMsg, userId);
    if (auto.retried) {
      return { pending: true, status: "AUTO_RETRY_QUEUED", message: auto.message };
    }
    if (auto.exhausted) {
      return { pending: false, status: "TIMED_OUT_RETRIES_EXHAUSTED", message: auto.message };
    }

    await supabase
      .from("medicaid_trips")
      .update({
        robot_last_status: resultStatus || jobStatus,
        robot_last_message: errMsg,
        robot_last_checked_at: nowIso,
      })
      .eq("id", trip.id);
    await supabase
      .from("billing_records")
      .update({
        status: "needs_fix",
        submission_error: errMsg,
        fix_notes: errMsg,
        requires_human_step: false,
      })
      .eq("id", rec.id);
    await logAudit(supabase, rec.id, userId, "robot_failed", errMsg);
    return { pending: false, status: resultStatus || jobStatus, message: errMsg };
}
