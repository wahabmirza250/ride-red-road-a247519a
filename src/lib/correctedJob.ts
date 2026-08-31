/**
 * CORRECTED-RESUBMISSION ROBOT JOB — pure decisions, no I/O.
 *
 * THE 2026-08-31 22:16 UTC INCIDENT
 * ---------------------------------
 * A corrected claim has its OWN billing record (`billing_records.resubmission_id`)
 * but SHARES the `medicaid_trips` row with the original denied claim. The trip
 * row still carries the original claim's `robot_confirmation_number` /
 * `submitted_confirmation`, so the shared reconciler short-circuited with
 * "Already submitted — portal confirmation #<ORIGINAL>", never polled the
 * corrected job, and the stuck-job sweep then quarantined the corrected record
 * with "Claim already exists at the portal". Fourteen corrected claims were
 * really dispatched to the robot and none of them was ever reconciled.
 *
 * THE RULE
 * --------
 * A billing record with a non-null `resubmission_id` is a CORRECTED claim. That
 * fact — not the shared trip's `robot_pass` and not the trip's claim history —
 * decides how the job is reconciled:
 *
 *   1. never short-circuit on the ORIGINAL trip/claim evidence;
 *   2. poll the exact `robot_job_id` already on the trip, at its sticky
 *      `robot_worker_url`; never dispatch or create a new job as recovery;
 *   3. write the outcome to the CORRECTED billing record and its linked
 *      `claim_resubmissions` row only — the original trip, the original denied
 *      record, their claim numbers, amounts and denial history are never
 *      touched;
 *   4. success requires a NEW confirmation number that differs from
 *      `original_claim_number`. The original number coming back is NOT success:
 *      it is held for manual HCPF verification, never marked submitted and
 *      never retried;
 *   5. a lost (404) or ambiguous job is held for verification, never resent;
 *   6. only PROVEN pre-Submit failure returns the corrected draft to Ready.
 */
import { extractConfirmationNumber } from "@/lib/claimReview";
import { isOriginalClaimReuse } from "@/lib/resubmissionLifecycle";
import { isJobNotFoundResponse, lostJobDecision } from "@/lib/robotJobLost";
import { isPreSubmitPacingCondition } from "@/lib/submitErrors";
import {
  hasExplicitPreSubmitFailureEvidence,
  looksLikeNoServiceLinesFailure,
  looksLikePossiblySubmittedTimeout,
  looksLikePostConfirmTimeout,
} from "@/lib/submitEvidence";

/** `medicaid_trips.robot_pass` value that marks a corrected run. */
export const CORRECTED_ROBOT_PASS = "resubmit";

/** `billing_records.failure_stage` used by every corrected hold. */
export const CORRECTED_FAILURE_STAGE = "corrected_verification";

export const CORRECTED_ORIGINAL_REUSE_CODE = "corrected_original_claim_reused";
export const CORRECTED_AMBIGUOUS_CODE = "corrected_outcome_unverified";
export const CORRECTED_JOB_LOST_CODE = "corrected_job_lost_unverified";
export const CORRECTED_CEILING_CODE = "corrected_inflight_ceiling_unverified";
export const CORRECTED_PRESUBMIT_CODE = "corrected_presubmit_failed";

/** Every failure code that means "a human must check HCPF for this correction". */
export const CORRECTED_HOLD_CODES = [
  CORRECTED_ORIGINAL_REUSE_CODE,
  CORRECTED_AMBIGUOUS_CODE,
  CORRECTED_JOB_LOST_CODE,
  CORRECTED_CEILING_CODE,
] as const;

export function isCorrectedHoldCode(code: string | null | undefined): boolean {
  return (CORRECTED_HOLD_CODES as readonly string[]).includes(String(code ?? ""));
}

/** Marker prefix stored on the corrected draft the first time a 404 is seen. */
export const CORRECTED_JOB_LOST_MARKER = "[corrected-job-not-found]";

export const CORRECTED_ORIGINAL_REUSE_MESSAGE =
  "The automation came back with the ORIGINAL claim number, so no new corrected " +
  "claim was proven. This correction was NOT marked submitted and will not be " +
  "resent automatically — check HCPF for a second claim on this date before doing " +
  "anything else.";

export const CORRECTED_NO_CLAIM_NUMBER_MESSAGE =
  "The automation reported the corrected claim as accepted but returned no claim " +
  "number, so it cannot be told apart from the original. Nothing was resent — " +
  "check HCPF for the new claim number and record it here.";

export const CORRECTED_AMBIGUOUS_MESSAGE =
  "The corrected claim run ended without a certain result, so it is unknown " +
  "whether HCPF received it. It was NOT resent — check HCPF for a new claim on " +
  "this date and record the outcome here.";

export const CORRECTED_JOB_LOST_WAIT_MESSAGE =
  "The automation service no longer knows about this corrected job (it was most " +
  "likely restarted). Checking again for a couple of minutes before deciding — " +
  "nothing is being resubmitted.";

export const CORRECTED_JOB_LOST_MESSAGE =
  "The corrected claim's automation job was lost (the service restarted), so it " +
  "is unknown whether HCPF received it. It was NOT resent — check HCPF for a new " +
  "claim on this date and record the outcome here.";

export const CORRECTED_CEILING_MESSAGE =
  "This corrected claim never reported a final result and has exceeded the " +
  "maximum processing time. It was NOT resent, because a new claim may already " +
  "exist at HCPF. Verify at the portal before doing anything else.";

export const CORRECTED_NO_JOB_MESSAGE =
  "No automation job is recorded for this corrected claim, so nothing was sent.";

/** A billing record is a corrected claim iff it carries a resubmission link. */
export function isCorrectedRecord(rec: { resubmission_id?: string | null } | null | undefined): boolean {
  return Boolean(rec?.resubmission_id);
}

/**
 * Corrected jobs must NEVER take the shared reconciler's
 * "already submitted — portal confirmation #X" short circuit: that X belongs to
 * the original denied claim, which the correction is replacing.
 */
export function shouldBypassOriginalClaimShortCircuit(rec: {
  resubmission_id?: string | null;
}): boolean {
  return isCorrectedRecord(rec);
}

/**
 * `robot_pass` for a submission run. A corrected record is always "resubmit",
 * whatever mode the caller asked for, so the trip row itself records that the
 * live job belongs to a correction.
 */
export function robotPassFor(args: {
  doesSubmit: boolean;
  resubmissionId?: string | null;
}): "capture" | "submit" | "resubmit" {
  if (args.resubmissionId) return CORRECTED_ROBOT_PASS;
  return args.doesSubmit ? "submit" : "capture";
}

export type CorrectedJobKind =
  /** Job is still running — change nothing. */
  | "pending"
  /** Transport failure talking to the worker — change nothing. */
  | "poll_error"
  /** The worker has no such job (404). Ambiguous: never a retry. */
  | "job_lost"
  /** A NEW confirmation number, different from the original. The only success. */
  | "new_claim"
  /** The worker returned the ORIGINAL claim number. Held, never submitted. */
  | "original_reuse"
  /** Unknown / possibly-submitted outcome. Held for manual HCPF verification. */
  | "ambiguous"
  /** Proven to have failed BEFORE Submit — no claim can exist. Back to Ready. */
  | "presubmit_failed";

export type CorrectedJobDecision = {
  kind: CorrectedJobKind;
  /** Reported status string (also used for the UI/audit trail). */
  status: string;
  message: string;
  /** Only ever set for `new_claim`. */
  claimNumber: string | null;
  /** Still in flight: the caller must not write a terminal state. */
  pending: boolean;
  /** A human must verify at HCPF before anything else may happen. */
  hold: boolean;
  /** The corrected draft may safely go back to Ready to Submit. */
  releaseToReady: boolean;
  /** `billing_records.failure_code` to store, when this is a hold. */
  failureCode: string | null;
};

const SUCCESS_STATUSES = ["SUBMITTED", "CONFIRMED", "SUCCESS", "COMPLETED"];

function pending(status: string, message: string | null): CorrectedJobDecision {
  return {
    kind: "pending",
    status,
    message: message ?? "The corrected claim is still running.",
    claimNumber: null,
    pending: true,
    hold: false,
    releaseToReady: false,
    failureCode: null,
  };
}

function hold(
  kind: CorrectedJobKind,
  status: string,
  message: string,
  failureCode: string,
): CorrectedJobDecision {
  return {
    kind,
    status,
    message,
    claimNumber: null,
    pending: false,
    hold: true,
    releaseToReady: false,
    failureCode,
  };
}

export type CorrectedPollInput = {
  /** HTTP status of `GET /job-status/<id>`. */
  httpStatus: number;
  /** Raw response body text (used for the 404 sniffing rules). */
  bodyText?: string | null;
  /** Parsed body, when the response was JSON. */
  body?: any;
  /** `claim_resubmissions.original_claim_number` — never a guess from the trip. */
  originalClaimNumber?: string | null;
};

/**
 * Turn one `/job-status/<id>` answer for a CORRECTED job into a decision.
 * Pure: it never reads or writes anything.
 */
export function classifyCorrectedJob(input: CorrectedPollInput): CorrectedJobDecision {
  const ok = input.httpStatus >= 200 && input.httpStatus < 300;
  const text = String(input.bodyText ?? "");

  if (!ok) {
    if (isJobNotFoundResponse(input.httpStatus, text)) {
      return {
        kind: "job_lost",
        status: "CORRECTED_JOB_NOT_FOUND",
        message: CORRECTED_JOB_LOST_WAIT_MESSAGE,
        claimNumber: null,
        pending: true,
        hold: false,
        releaseToReady: false,
        failureCode: CORRECTED_JOB_LOST_CODE,
      };
    }
    return {
      kind: "poll_error",
      status: "poll_error",
      message: `Poll failed (${input.httpStatus}): ${text.slice(0, 200)}`,
      claimNumber: null,
      pending: true,
      hold: false,
      releaseToReady: false,
      failureCode: null,
    };
  }

  const body = input.body ?? {};
  const jobStatus = String(body?.status ?? "unknown");
  const result = body?.result ?? {};
  const resultStatus = String(result?.status ?? "");
  const reason: string | null =
    (typeof result?.reason === "string" && result.reason) ||
    (typeof result?.message === "string" && result.message) ||
    (typeof result?.error === "string" && result.error) ||
    (typeof body?.error === "string" && body.error) ||
    null;

  if (jobStatus !== "done" && jobStatus !== "error") return pending(jobStatus, reason);

  const confirmation =
    extractConfirmationNumber(result) ?? extractConfirmationNumber(body) ?? null;

  // RULE 4. The original claim number is never proof of a corrected claim.
  if (confirmation && isOriginalClaimReuse(confirmation, input.originalClaimNumber)) {
    return hold(
      "original_reuse",
      "CORRECTED_ORIGINAL_CLAIM_REUSED",
      CORRECTED_ORIGINAL_REUSE_MESSAGE,
      CORRECTED_ORIGINAL_REUSE_CODE,
    );
  }

  if (confirmation) {
    return {
      kind: "new_claim",
      status: "submitted",
      message: `The corrected claim was accepted as NEW confirmation #${confirmation}.`,
      claimNumber: confirmation,
      pending: false,
      hold: false,
      releaseToReady: false,
      failureCode: null,
    };
  }

  // "Accepted" with no readable claim number cannot be told apart from the
  // original claim, so it is a verification hold — never a submitted state.
  if (SUCCESS_STATUSES.includes(resultStatus.toUpperCase())) {
    return hold(
      "ambiguous",
      "CORRECTED_SUBMITTED_NO_CLAIM_NUMBER",
      CORRECTED_NO_CLAIM_NUMBER_MESSAGE,
      CORRECTED_AMBIGUOUS_CODE,
    );
  }

  const detail = reason ?? "";

  // RULE 6. PROVEN pre-Submit failure — no claim can exist, so the corrected
  // draft goes back to Ready to Submit with nothing held.
  const provenNotSent =
    looksLikeNoServiceLinesFailure(detail) ||
    resultStatus.toUpperCase() === "READY_FOR_HUMAN_REVIEW" ||
    resultStatus.toUpperCase() === "STOPPED_BEFORE_SUBMIT" ||
    isPreSubmitPacingCondition(detail) ||
    hasExplicitPreSubmitFailureEvidence(detail);
  const possiblySubmitted =
    looksLikePossiblySubmittedTimeout(detail) || looksLikePostConfirmTimeout(detail);

  if (provenNotSent && !possiblySubmitted) {
    const message =
      "No corrected claim was created — the automation stopped before the portal " +
      "Submit step, so nothing reached HCPF. This correction is back in Ready to " +
      `Submit. Portal detail: ${(detail || resultStatus || jobStatus).slice(0, 300)}`;
    return {
      kind: "presubmit_failed",
      status: resultStatus || "CORRECTED_PRE_SUBMIT_FAILED",
      message,
      claimNumber: null,
      pending: false,
      hold: false,
      releaseToReady: true,
      failureCode: CORRECTED_PRESUBMIT_CODE,
    };
  }

  return hold(
    "ambiguous",
    resultStatus || jobStatus || "CORRECTED_OUTCOME_UNKNOWN",
    detail
      ? `${CORRECTED_AMBIGUOUS_MESSAGE} Portal detail: ${detail.slice(0, 300)}`
      : CORRECTED_AMBIGUOUS_MESSAGE,
    CORRECTED_AMBIGUOUS_CODE,
  );
}

/**
 * Lost-job window for a corrected job. The first 404 stores a marker on the
 * corrected draft; the decision is only taken once the window has passed, so a
 * worker redeploy does not flag a healthy job.
 */
export function correctedLostJobStep(input: {
  failureReason: string | null | undefined;
  markedAt: string | null | undefined;
  now?: number;
}): "mark" | "wait" | "verify" {
  const marked = String(input.failureReason ?? "").startsWith(CORRECTED_JOB_LOST_MARKER);
  if (!marked) return "mark";
  return lostJobDecision({ firstSeenAt: input.markedAt ?? null, now: input.now }) === "verify"
    ? "verify"
    : "wait";
}
