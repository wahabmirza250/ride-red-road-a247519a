/**
 * WHAT A BILL'S STATE IS ALLOWED TO SAY (pure — safe on the client).
 *
 * "Submitted", "Approved", "Paid", "Denied" are claims about what the STATE
 * portal did. None of them may be shown unless the bill actually carries a real
 * 13-digit HCPF claim number and the portal itself has been read back.
 *
 * Without that proof the honest label is "Awaiting portal verification" —
 * except for the ordinary pre-submit workflow case (a bill queued up and never
 * sent), which is simply "Ready to submit".
 *
 * This module decides the words only; it never changes a stored status.
 */
import { isPortalClaimNumber, normalizeClaimNumber } from "@/lib/claimConfirmation";

/** Stored statuses that assert something about the state portal. */
export const PORTAL_BACKED_STATUSES = [
  "submitted",
  "approved",
  "paid",
  "denied",
  "rejected",
] as const;

export type ClaimStateInput = {
  status?: string | null;
  state_confirmation_number?: string | null;
  portal_status_raw?: string | null;
  portal_paid_amount?: number | string | null;
  portal_charged_amount?: number | string | null;
  status_check_last_at?: string | null;
  status_checked_at?: string | null;
  submitted_at?: string | null;
};

export type PresentedClaimState = {
  /** Stable key for styling/tests. */
  key:
    | "ready"
    | "awaiting_verification"
    | "submitted"
    | "paid"
    | "denied"
    | "rejected"
    | "other";
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  /** True when a real claim number + portal read back this state. */
  evidenceBacked: boolean;
  /** One sentence a biller can act on when evidence is missing. */
  detail: string | null;
};

/** A real 13-digit HCPF claim number is on the bill. */
export function hasRealClaimNumber(rec: ClaimStateInput | null | undefined): boolean {
  return isPortalClaimNumber(rec?.state_confirmation_number ?? null);
}

/** The portal itself has been read back for this bill. */
export function hasPortalStatusEvidence(rec: ClaimStateInput | null | undefined): boolean {
  if (!rec) return false;
  if (String(rec.portal_status_raw ?? "").trim() !== "") return true;
  if (rec.portal_paid_amount !== null && rec.portal_paid_amount !== undefined) return true;
  if (rec.portal_charged_amount !== null && rec.portal_charged_amount !== undefined) return true;
  if (rec.status_check_last_at) return true;
  if (rec.status_checked_at) return true;
  return false;
}

const PORTAL_LABEL: Record<string, { key: PresentedClaimState["key"]; label: string; tone: PresentedClaimState["tone"] }> = {
  submitted: { key: "submitted", label: "Submitted", tone: "info" },
  paid: { key: "paid", label: "Paid", tone: "success" },
  denied: { key: "denied", label: "Denied", tone: "danger" },
  rejected: { key: "rejected", label: "Rejected", tone: "danger" },
  approved: { key: "paid", label: "Approved by HCPF", tone: "success" },
};

export const AWAITING_PORTAL_VERIFICATION_LABEL = "Awaiting portal verification";

/**
 * The state this bill may honestly be presented as.
 * `status` values outside the portal-backed set are returned untouched so the
 * existing workflow wording (Review, Processing, Needs Attention…) is unchanged.
 */
export function presentClaimState(rec: ClaimStateInput | null | undefined): PresentedClaimState {
  const status = String(rec?.status ?? "").trim().toLowerCase();
  if (!(PORTAL_BACKED_STATUSES as readonly string[]).includes(status))
    return { key: "other", label: "", tone: "neutral", evidenceBacked: false, detail: null };

  const claim = normalizeClaimNumber(rec?.state_confirmation_number ?? null);
  const realClaim = hasRealClaimNumber(rec);

  // Pre-submit workflow: "approved" here has always meant "ready to submit",
  // never "the state approved it".
  if (status === "approved" && !claim && !rec?.submitted_at)
    return {
      key: "ready",
      label: "Ready to submit",
      tone: "neutral",
      evidenceBacked: true,
      detail: null,
    };

  if (!realClaim)
    return {
      key: "awaiting_verification",
      label: AWAITING_PORTAL_VERIFICATION_LABEL,
      tone: "warning",
      evidenceBacked: false,
      detail: claim
        ? `The claim number on this bill ("${claim}") is not a 13-digit HCPF claim number, so the portal state cannot be confirmed.`
        : "No HCPF claim number is attached to this bill, so its portal state cannot be confirmed.",
    };

  // Submitted only needs the claim number itself; a money/state claim needs the
  // portal to have been read back.
  if (status !== "submitted" && !hasPortalStatusEvidence(rec))
    return {
      key: "awaiting_verification",
      label: AWAITING_PORTAL_VERIFICATION_LABEL,
      tone: "warning",
      evidenceBacked: false,
      detail: `Claim #${claim} has not been read back from HCPF yet, so "${status}" is not confirmed.`,
    };

  const mapped = PORTAL_LABEL[status] ?? { key: "other" as const, label: status, tone: "neutral" as const };
  return { ...mapped, evidenceBacked: true, detail: null };
}

/** Convenience: may this bill be shown with a portal state at all? */
export function isEvidenceBackedPortalState(rec: ClaimStateInput | null | undefined): boolean {
  const s = presentClaimState(rec);
  return s.key !== "awaiting_verification";
}
