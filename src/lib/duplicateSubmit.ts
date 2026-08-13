/**
 * Shared contract for the "this trip was already submitted" warning.
 *
 * The server no longer hard-blocks a resubmission: it throws a structured
 * error the UI can turn into an explicit confirmation dialog. Only an
 * acknowledged retry (`acknowledge_duplicate: true`) is allowed through, and
 * it is written to the billing audit trail.
 */
export const DUPLICATE_CLAIM_PREFIX = "DUPLICATE_CLAIM:";

export type DuplicateClaimInfo = {
  /** Existing portal confirmation / claim number, when one is known. */
  claim: string | null;
  /** Human-readable current status of the trip. */
  status: string;
  /** True when the claim reached the portal but the outcome was never verified. */
  unverified: boolean;
};

export function duplicateClaimError(info: DuplicateClaimInfo): Error {
  return new Error(DUPLICATE_CLAIM_PREFIX + JSON.stringify(info));
}

/** Returns the duplicate info when an error is the structured duplicate signal. */
export function parseDuplicateClaimError(e: unknown): DuplicateClaimInfo | null {
  const msg =
    typeof e === "string" ? e : (e as any)?.message ? String((e as any).message) : "";
  const at = msg.indexOf(DUPLICATE_CLAIM_PREFIX);
  if (at < 0) return null;
  try {
    const parsed = JSON.parse(msg.slice(at + DUPLICATE_CLAIM_PREFIX.length));
    return {
      claim: parsed?.claim ?? null,
      status: String(parsed?.status ?? "unknown"),
      unverified: !!parsed?.unverified,
    };
  } catch {
    return null;
  }
}

export function duplicateWarningText(info: DuplicateClaimInfo): string {
  const claim = info.claim ? `Claim #${info.claim}` : "an existing portal claim";
  const tail = info.unverified
    ? " The previous attempt reached the portal but its outcome was never verified, so a claim may already exist."
    : "";
  return `This trip was already submitted (${claim}, current status: ${info.status}). Submitting again may create a duplicate claim.${tail} Are you sure you want to continue?`;
}
