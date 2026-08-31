/**
 * NEEDS FIX — plain-English category + next action.
 *
 * Billers must never read a Playwright stack trace or raw portal HTML. Every
 * blocked bill maps to one of a small set of categories, each with a single
 * next action.
 */
import { isAmbiguousOutcomeMessage, isPreSubmitPacingCondition } from "@/lib/submitErrors";
import { isPortalNavigationFailure } from "@/lib/portalNavigation";
import { UNVERIFIED_STATUS } from "@/lib/resendGate";
import { requiresManualVerification } from "@/lib/needsVerification";
import { isCorrectedHoldCode, CORRECTED_ORIGINAL_REUSE_CODE } from "@/lib/correctedJob";

export type NeedsFixCategory =
  | "submitted"
  | "unverified"
  | "capacity"
  | "data"
  | "duplicate"
  | "unknown";

export type NeedsFixSummary = {
  category: NeedsFixCategory;
  label: string;
  nextAction: string;
  /** True when a biller edit can actually unblock this bill. */
  editable: boolean;
};

export type NeedsFixInput = {
  status?: string | null;
  requires_human_step?: boolean | null;
  submission_error?: string | null;
  submit_last_error?: string | null;
  failure_code?: string | null;
  state_confirmation_number?: string | null;
  robot_confirmation_number?: string | null;
  robot_last_status?: string | null;
  /** Set when this row is a CORRECTED claim's own billing record. */
  resubmission_id?: string | null;
};

export function needsFixSummary(rec: NeedsFixInput): NeedsFixSummary {
  // A corrected claim shares its trip with the original denied claim, so the
  // trip-level confirmation number is the ORIGINAL's. Only the corrected
  // record's own number may ever label a correction "Submitted".
  const corrected = Boolean(rec.resubmission_id);
  if (rec.state_confirmation_number || (!corrected && rec.robot_confirmation_number))
    return {
      category: "submitted",
      label: "Submitted",
      nextAction: "Claim number on file — nothing to resend.",
      editable: false,
    };

  if (rec.failure_code === CORRECTED_ORIGINAL_REUSE_CODE)
    return {
      category: "unverified",
      label: "Corrected claim returned the original number",
      nextAction:
        "Check HCPF for a NEW claim on this date. Nothing was resent and nothing will be.",
      editable: false,
    };

  if (isCorrectedHoldCode(rec.failure_code))
    return {
      category: "unverified",
      label: "Corrected claim needs HCPF verification",
      nextAction:
        "Check HCPF for a new claim on this date — the correction was NOT resent.",
      editable: false,
    };


  const msg = rec.submission_error ?? rec.submit_last_error ?? null;

  if (
    requiresManualVerification(rec) ||
    (rec.robot_last_status ?? "") === UNVERIFIED_STATUS ||
    rec.failure_code === "ambiguous_outcome" ||
    (isAmbiguousOutcomeMessage(msg) && !isPreSubmitPacingCondition(msg))
  )
    return {
      category: "unverified",
      label: "Needs verification",
      nextAction: "Check HCPF manually — editing and resending are blocked.",
      editable: false,
    };

  if (isPortalNavigationFailure(msg) || rec.failure_code === "portal_navigation")
    return {
      category: "capacity",
      label: "Portal menu did not load — waiting to retry",
      nextAction: "Nothing was submitted and no attempt was used — it starts again automatically.",
      editable: false,
    };

  if (isPreSubmitPacingCondition(msg) || rec.failure_code === "worker_capacity")
    return {
      category: "capacity",
      label: "Robot capacity busy — waiting for a worker",
      nextAction: "Nothing was submitted and no attempt was used — it starts again automatically.",
      editable: false,
    };


  if (/duplicate/i.test(msg ?? ""))
    return {
      category: "duplicate",
      label: "Possible duplicate",
      nextAction: "Check the existing claim for this member and service date.",
      editable: true,
    };

  if (msg)
    return {
      category: "data",
      label: "Needs a data correction",
      nextAction: "Open Edit & fix, correct the flagged field, then save.",
      editable: true,
    };

  return {
    category: "unknown",
    label: "Needs review",
    nextAction: "Open the bill to see what is missing.",
    editable: true,
  };
}
