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
  | "config"
  | "member_data"
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
  /** Where a person should go to clear this. */
  action?: "configure_rates" | "assign_provider" | "portal_credentials" | "edit_bill";
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

const CONFIG_BLOCKS: Array<{
  test: RegExp;
  code?: string;
  summary: NeedsFixSummary;
}> = [
  {
    code: "BLOCKED_MISSING_BILLING_RATES",
    test: /billing rates? (are )?not configured|missing (trip|mileage) rate/i,
    summary: {
      category: "config",
      label: "Billing rates not configured",
      nextAction: "Set the trip and mileage rates for this provider, then recheck the bill.",
      action: "configure_rates",
      editable: false,
    },
  },
  {
    code: "BLOCKED_MISSING_DIAGNOSIS_CODE",
    test: /diagnosis code/i,
    summary: {
      category: "config",
      label: "Diagnosis code not configured",
      nextAction: "Add the default diagnosis code to the billing rates, then recheck the bill.",
      action: "configure_rates",
      editable: false,
    },
  },
  {
    code: "BLOCKED_MISSING_PROVIDER_ID",
    test: /provider(_| )id|billing provider is not assigned|no provider account/i,
    summary: {
      category: "config",
      label: "Billing provider not assigned",
      nextAction: "Choose the company's billing provider in billing setup, then recheck the bill.",
      action: "assign_provider",
      editable: false,
    },
  },
  {
    code: "BLOCKED_MISSING_PORTAL_CREDENTIALS",
    test: /portal (login|credential)/i,
    summary: {
      category: "config",
      label: "Portal login missing",
      nextAction: "Add the state portal login in billing settings, then recheck the bill.",
      action: "portal_credentials",
      editable: false,
    },
  },
  {
    code: "BLOCKED_PENDING_ELIGIBILITY_LOOKUP",
    test: /medicaid (member )?id|member id is missing/i,
    summary: {
      category: "member_data",
      label: "Medicaid member ID missing",
      nextAction: "Add the member's Medicaid ID on the passenger or the bill, then save.",
      action: "edit_bill",
      editable: true,
    },
  },
];

function configurationBlock(
  failureCode: string | null | undefined,
  message: string | null,
): NeedsFixSummary | null {
  const code = (failureCode ?? "").trim().toUpperCase();
  for (const b of CONFIG_BLOCKS) {
    if (b.code && code === b.code) return b.summary;
  }
  const msg = message ?? "";
  if (!msg) return null;
  for (const b of CONFIG_BLOCKS) {
    if (b.test.test(msg)) return b.summary;
  }
  return null;
}

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

  // KNOWN CONFIGURATION BLOCKS. These are never a claim-data problem, so the
  // biller is pointed at the one screen that actually fixes them.
  const blocked = configurationBlock(rec.failure_code, msg);
  if (blocked) return blocked;

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
