/**
 * NEEDS FIX — plain-English category + next action.
 *
 * Billers must never read a Playwright stack trace or raw portal HTML. Every
 * blocked bill maps to one of a small set of categories, each with a single
 * next action.
 */
import { isAmbiguousOutcomeMessage, isPreSubmitPacingCondition } from "@/lib/submitErrors";
import { UNVERIFIED_STATUS } from "@/lib/resendGate";

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
};

export function needsFixSummary(rec: NeedsFixInput): NeedsFixSummary {
  if (rec.state_confirmation_number || rec.robot_confirmation_number)
    return {
      category: "submitted",
      label: "Submitted",
      nextAction: "Claim number on file — nothing to resend.",
      editable: false,
    };

  const msg = rec.submission_error ?? rec.submit_last_error ?? null;

  if (
    (rec.robot_last_status ?? "") === UNVERIFIED_STATUS ||
    rec.failure_code === "ambiguous_outcome" ||
    (isAmbiguousOutcomeMessage(msg) && !isPreSubmitPacingCondition(msg))
  )
    return {
      category: "unverified",
      label: "Outcome not verified",
      nextAction: "Verification runs automatically — do not resend.",
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
