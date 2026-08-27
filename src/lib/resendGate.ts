/**
 * CORRECTED-RESUBMISSION GATE (client + server share this one rule set).
 *
 * A biller who fixes a genuine data problem (member, driver, report, date…)
 * must be able to put the bill back into Ready to Submit. What must NEVER be
 * unblocked this way:
 *   - a bill that already carries a real portal claim number,
 *   - a bill whose outcome is uncertain AFTER Submit/Confirm (quarantined,
 *     handled only by read-only verification),
 *   - a bill that is live in the queue right now.
 *
 * Everything else — stale needs_fix flags, pre-submit pacing (account busy,
 * browser launch failure), plain validation failures — is recoverable.
 */
import { isAmbiguousOutcomeMessage, isPreSubmitPacingCondition } from "@/lib/submitErrors";

export const UNVERIFIED_STATUS = "SUBMITTED_UNVERIFIED";

export type ResendCandidate = {
  status?: string | null;
  requires_human_step?: boolean | null;
  submission_error?: string | null;
  submit_last_error?: string | null;
  failure_code?: string | null;
  failure_stage?: string | null;
  state_confirmation_number?: string | null;
  robot_confirmation_number?: string | null;
  submitted_confirmation?: string | null;
  robot_last_status?: string | null;
};

export type ResendDecision = { allowed: boolean; reason: string };

const LIVE_STATUSES = new Set(["queued", "submitting"]);

/** Post-Submit uncertainty on any evidence field. */
export function isQuarantinedOutcome(rec: ResendCandidate): boolean {
  if ((rec.robot_last_status ?? "") === UNVERIFIED_STATUS) return true;
  if (rec.failure_code === "ambiguous_outcome") return true;
  const msgs = [rec.submission_error, rec.submit_last_error];
  return msgs.some((m) => isAmbiguousOutcomeMessage(m) && !isPreSubmitPacingCondition(m));
}

export function canResendAfterCorrection(rec: ResendCandidate): ResendDecision {
  if (rec.state_confirmation_number || rec.robot_confirmation_number || rec.submitted_confirmation)
    return {
      allowed: false,
      reason: "This claim already has a portal claim number — it can't be resent from here.",
    };
  if (isQuarantinedOutcome(rec))
    return {
      allowed: false,
      reason:
        "The portal outcome for this bill was never verified — it stays quarantined until verification finishes.",
    };
  if (LIVE_STATUSES.has(String(rec.status ?? "")))
    return { allowed: false, reason: "This bill is already waiting in the submission queue." };
  return { allowed: true, reason: "Corrected data can be sent back to Ready to Submit." };
}

/** Short, human-readable reason for why a bill is currently blocked. */
export function blockingReasonLabel(rec: ResendCandidate): string | null {
  if (!rec.requires_human_step && rec.status !== "needs_fix") return null;
  const msg = rec.submission_error ?? rec.submit_last_error ?? null;
  if (isPreSubmitPacingCondition(msg))
    return "Waiting for automation capacity — nothing was submitted.";
  if (isQuarantinedOutcome(rec)) return "Outcome not verified — awaiting portal verification.";
  return "Needs a data correction before it can be sent again.";
}
