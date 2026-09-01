/**
 * CORRECTED-RESUBMISSION READ-ONLY VERIFICATION (pure rules).
 *
 * A corrected claim whose robot run ended ambiguous (timeout, unreadable input,
 * lost job) may already exist at HCPF. The only safe way to settle it is a
 * READ-ONLY portal search by member Medicaid ID + corrected service date.
 *
 * Nothing here submits, resubmits, retries or recreates a job. It only decides
 * whether the search answer is safe enough to attach automatically.
 */
import type { PortalClaim } from "@/lib/hcpfSearch";

/** Hold codes whose bills are eligible for automatic read-only verification. */
export const VERIFIABLE_CORRECTED_CODES = [
  "corrected_outcome_unverified",
  "corrected_job_lost_unverified",
  "corrected_inflight_ceiling_unverified",
] as const;

export function isVerifiableCorrectedCode(code: string | null | undefined): boolean {
  return (VERIFIABLE_CORRECTED_CODES as readonly string[]).includes(String(code ?? ""));
}

export type CorrectedMatch =
  | { kind: "unique"; claim: PortalClaim; reason: string }
  | { kind: "none"; reason: string }
  | { kind: "multiple"; claims: PortalClaim[]; reason: string };

const sameId = (a: unknown, b: unknown) =>
  String(a ?? "").replace(/\s+/g, "") === String(b ?? "").replace(/\s+/g, "") &&
  String(a ?? "").trim() !== "";

/**
 * Accept ONLY a single unused claim whose id differs from the original denied
 * claim. Anything else keeps the Verification Hold for a human.
 */
export function pickCorrectedMatch(args: {
  claims: PortalClaim[];
  originalClaimNumber: string | null | undefined;
  /** Claim ids already attached to any RedArt bill. */
  usedClaimNumbers?: Iterable<string>;
}): CorrectedMatch {
  const used = new Set(
    [...(args.usedClaimNumbers ?? [])].map((s) => String(s).replace(/\s+/g, "")),
  );
  const all = args.claims ?? [];
  if (!all.length)
    return { kind: "none", reason: "HCPF returned no claim for this member and corrected service date." };

  const candidates = all.filter((c) => {
    if (sameId(c.claim_id, args.originalClaimNumber)) return false; // the denied original
    if (used.has(String(c.claim_id).replace(/\s+/g, ""))) return false; // already linked
    if (c.linked) return false;
    return true;
  });

  if (candidates.length === 0)
    return {
      kind: "none",
      reason:
        "Every claim HCPF returned is either the original denied claim or already linked to another RedArt bill, so no new corrected claim exists yet.",
    };
  if (candidates.length > 1)
    return {
      kind: "multiple",
      claims: candidates,
      reason: `HCPF returned ${candidates.length} possible new claims (${candidates
        .map((c) => `#${c.claim_id}`)
        .join(", ")}) — a person must pick the right one.`,
    };
  const claim = candidates[0]!;
  return {
    kind: "unique",
    claim,
    reason: `Exactly one new HCPF claim (#${claim.claim_id}) exists for this member and corrected service date, and it differs from the original denied claim.`,
  };
}
