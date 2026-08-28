/**
 * NEEDS ATTENTION — SAFE ARCHIVE / DISMISS.
 *
 * The Needs Attention list is an operational worklist, not an audit trail.
 * Over time it fills with errors that are no longer actionable (the bill was
 * later submitted, or a biller fixed the data). Billers need those gone from
 * the ACTIVE view — but nothing may ever be deleted, reset, or made retryable.
 *
 * Hard rules encoded here:
 *   - Archiving NEVER changes status, evidence, idempotency keys or any
 *     submit_* column. It only stamps `attention_archived_*`.
 *   - An UNCERTAIN HCPF outcome can never be archived. It stays in the
 *     Needs Verification workflow until a human reconciles it.
 *   - A row whose error text already names a portal confirmation number is
 *     routed to the existing reconciliation path ("Claim found"), never
 *     archived — the evidence must be recorded, not hidden.
 *   - Active work (queued / submitting) is untouchable.
 */

/** Failure codes that mean "we do not know what happened at HCPF". */
export const UNCERTAIN_FAILURE_CODES = new Set([
  "ambiguous_outcome",
  "inflight_ceiling_unverified",
  "needs_human_verification",
  "worker_unavailable",
  "duplicate_claim_found",
]);

const ACTIVE_STATUSES = new Set(["queued", "submitting"]);
const RESOLVED_STATUSES = new Set(["submitted", "paid", "approved", "denied", "rejected"]);

const UNCERTAIN_TEXT =
  /could not be verified|awaiting verification|may already exist|SUBMITTED_UNVERIFIED|never reported a final result|stopped before the automation service confirmed/i;

export type AttentionRow = {
  id?: string;
  status?: string | null;
  requires_human_step?: boolean | null;
  submission_error?: string | null;
  fix_notes?: string | null;
  failure_code?: string | null;
  state_confirmation_number?: string | null;
  robot_confirmation_number?: string | null;
  submitted_confirmation?: string | null;
  robot_last_status?: string | null;
  attention_archived_at?: string | null;
};

/**
 * Pull an HCPF confirmation/claim number out of free error text, e.g.
 * `Claim already exists at the portal (confirmation #2326239001622).`
 * Returns null unless the number is unambiguous (9-20 digits).
 */
export function extractPortalConfirmation(text: string | null | undefined): string | null {
  if (!text) return null;
  const m =
    /(?:confirmation|claim)\s*(?:number|no\.?|#)?\s*[#:]?\s*(\d{9,20})\b/i.exec(String(text)) ??
    /#(\d{9,20})\b/.exec(String(text));
  return m ? m[1] : null;
}

export type AttentionDecision =
  | { action: "archive"; reason: string }
  | { action: "reconcile"; confirmation: string; reason: string }
  | { action: "blocked"; reason: string };

/**
 * What a biller is allowed to do with one Needs Attention row.
 * Pure — every caller (UI and server) uses exactly this decision.
 */
export function decideAttentionAction(rec: AttentionRow): AttentionDecision {
  const status = String(rec.status ?? "");

  if (ACTIVE_STATUSES.has(status)) {
    return {
      action: "blocked",
      reason: "This bill is still being processed — it cannot be archived while it is active.",
    };
  }

  const known =
    rec.state_confirmation_number ||
    rec.robot_confirmation_number ||
    rec.submitted_confirmation ||
    extractPortalConfirmation(rec.submission_error) ||
    extractPortalConfirmation(rec.fix_notes);
  if (known) {
    return {
      action: "reconcile",
      confirmation: String(known),
      reason:
        "A portal confirmation number is already known for this bill. Record it through Manual HCPF Verification instead of archiving it.",
    };
  }

  if (RESOLVED_STATUSES.has(status)) {
    return { action: "archive", reason: "Resolved — the bill has moved on from this error." };
  }

  const uncertain =
    Boolean(rec.requires_human_step) ||
    UNCERTAIN_FAILURE_CODES.has(String(rec.failure_code ?? "")) ||
    UNCERTAIN_TEXT.test(String(rec.submission_error ?? "")) ||
    /^SUBMITTED/i.test(String(rec.robot_last_status ?? ""));
  if (uncertain) {
    return {
      action: "blocked",
      reason:
        "The portal outcome for this bill is still unverified. It stays in Needs Verification until a human confirms it at HCPF.",
    };
  }

  return { action: "archive", reason: "No longer actionable — dismissed from the active list." };
}

export const canArchiveAttention = (rec: AttentionRow) =>
  decideAttentionAction(rec).action === "archive";

/** Rows shown in the ACTIVE Needs Attention view. */
export function isActiveAttentionRow(rec: AttentionRow): boolean {
  return !rec.attention_archived_at;
}

export function filterAttentionRows<T extends AttentionRow>(
  rows: T[],
  opts: { includeArchived?: boolean } = {},
): T[] {
  return opts.includeArchived ? rows : rows.filter(isActiveAttentionRow);
}
