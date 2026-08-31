/**
 * CORRECTED RESUBMISSION STATE MACHINE (pure decisions, no I/O).
 *
 * States
 * ------
 *   draft       biller is still editing
 *   queued      READY TO SUBMIT — selectable, nothing sent
 *   processing  atomically claimed and handed to the shared submit path;
 *               it leaves Ready immediately so it can never be sent twice
 *   submitted   a NEW portal confirmation number exists (never the original)
 *   paid/denied the portal proved the outcome of the NEW claim
 *   failed      definitively not sent — no claim could have been created;
 *               needs an explicit owner Retry, never an automatic one
 *   cancelled   discarded by the biller
 *
 * The DB enforces the same set plus a partial unique index over
 * (draft, queued, processing) so one trip can only ever have ONE active
 * corrected claim.
 */

export const RESUBMISSION_STATUSES = [
  "draft",
  "queued",
  "processing",
  "submitted",
  "paid",
  "denied",
  "failed",
  "cancelled",
] as const;
export type ResubmissionStatus = (typeof RESUBMISSION_STATUSES)[number];

/** Statuses protected by the one-live-per-trip unique index. */
export const ACTIVE_RESUBMISSION_STATUSES: ResubmissionStatus[] = [
  "draft",
  "queued",
  "processing",
];

/** The ONE status that means "visible and selectable in Ready to Submit". */
export const READY_RESUBMISSION_STATUS: ResubmissionStatus = "queued";

/** Statuses whose corrected snapshot must still overlay the robot payload. */
export const IN_FLIGHT_RESUBMISSION_STATUSES: ResubmissionStatus[] = ["queued", "processing"];

export function isReadyResubmission(status: string | null | undefined): boolean {
  return String(status ?? "") === READY_RESUBMISSION_STATUS;
}

export function isProcessingResubmission(status: string | null | undefined): boolean {
  return String(status ?? "") === "processing";
}

/** The original denied claim number can never become the new confirmation. */
export function isOriginalClaimReuse(
  newConfirmation: string | null | undefined,
  originalClaimNumber: string | null | undefined,
): boolean {
  const a = String(newConfirmation ?? "").trim();
  const b = String(originalClaimNumber ?? "").trim();
  return a !== "" && b !== "" && a === b;
}

/**
 * Phrases the robot reconciliation uses when it can PROVE the portal never
 * received the claim. Anything outside this list is treated as uncertain.
 */
const DEFINITELY_NOT_SENT = [
  "no claim was created",
  "nothing was sent",
  "was not submitted",
  "stopped before clicking submit",
  "did not complete",
];

export type RobotOutcome = {
  pending?: boolean;
  status?: string | null;
  message?: string | null;
  confirmation_number?: string | null;
  /** billing_records.status AFTER the shared reconciliation wrote it. */
  billingStatus?: string | null;
};

export type ResubmissionTransition = {
  /** Target status, or null when the row must stay exactly as it is. */
  next: "submitted" | "failed" | null;
  /** New portal confirmation, only for `submitted`. */
  claimNumber: string | null;
  reason: string;
};

/**
 * Map one shared-robot outcome onto the corrected resubmission row.
 * Uncertain outcomes deliberately return `next: null` — the row stays in
 * `processing` (out of Ready) and is resolved by verification, never retried.
 */
export function classifyResubmissionOutcome(
  outcome: RobotOutcome,
  originalClaimNumber?: string | null,
): ResubmissionTransition {
  const confirmation = String(outcome.confirmation_number ?? "").trim() || null;
  const billing = String(outcome.billingStatus ?? "").toLowerCase();
  const text = `${outcome.status ?? ""} ${outcome.message ?? ""}`.toLowerCase();

  if (outcome.pending) {
    return { next: null, claimNumber: null, reason: "The submission is still running." };
  }

  if (confirmation && isOriginalClaimReuse(confirmation, originalClaimNumber)) {
    return {
      next: null,
      claimNumber: null,
      reason:
        "The portal returned the ORIGINAL claim number, so no new claim was proven. " +
        "This corrected claim needs manual HCPF verification.",
    };
  }

  if (confirmation && (billing === "submitted" || billing === "paid" || billing === "denied")) {
    return {
      next: "submitted",
      claimNumber: confirmation,
      reason: `The portal accepted the corrected claim as new confirmation #${confirmation}.`,
    };
  }

  if (!confirmation && DEFINITELY_NOT_SENT.some((p) => text.includes(p))) {
    return {
      next: "failed",
      claimNumber: null,
      reason:
        outcome.message?.trim() ||
        "The corrected claim was not sent to the portal. No claim was created.",
    };
  }

  return {
    next: null,
    claimNumber: null,
    reason:
      "The outcome of this corrected claim is not certain yet. It stays out of Ready to Submit " +
      "until the portal status is verified.",
  };
}

/** Later portal truth on the NEW claim: submitted -> paid / denied. */
export function classifyPortalFinancialStatus(
  currentStatus: string | null | undefined,
  portalStatus: string | null | undefined,
): "paid" | "denied" | null {
  if (String(currentStatus ?? "") !== "submitted") return null;
  const s = String(portalStatus ?? "").trim().toLowerCase();
  if (s === "paid") return "paid";
  if (s === "denied" || s === "rejected") return "denied";
  return null;
}

/** Only a `failed` corrected claim may be moved back to Ready, and only by a human. */
export function canRetryResubmission(status: string | null | undefined): boolean {
  return String(status ?? "") === "failed";
}
