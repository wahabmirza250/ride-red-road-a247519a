/**
 * STALE "WORKER STOPPED" FLAGS vs. PROVEN PORTAL RECONCILIATION (pure).
 *
 * Some bills are parked in Needs Fix with a PRE-SUBMIT worker failure
 * (`failure_code = 'worker_unavailable'`, `failure_stage = 'worker'`, the old
 * "the worker stopped / automation service is unavailable" message). Those
 * flags mean "nothing was sent" — they are NOT a manual-verification
 * quarantine, which is exactly why the audited verification writer refuses to
 * touch them ("This bill is not awaiting manual HCPF verification").
 *
 * A completed read-only sweep can, however, PROVE the opposite: the portal
 * itself shows exactly one unused claim in a final state for the same company,
 * member and service date. Against that proof the worker flag is simply stale
 * bookkeeping, and blocking reconciliation on it would leave real money
 * unreconciled forever.
 *
 * So: the flag may be cleared ONLY together with an attached, portal-proven
 * claim. It is never cleared on its own, never on a bill that already has a
 * claim number, and never for a genuine verification case (an interrupted
 * submission that may have created a claim) — those still need a human.
 *
 * Pure module — no data access, safe on the client.
 */
import { hasClaimEvidence, requiresManualVerification, type VerificationCandidate } from "@/lib/needsVerification";

/** Pre-submit worker failures that a portal proof may override. */
export const STALE_WORKER_FAILURE_CODES = ["worker_unavailable", "worker_capacity"] as const;

const STALE_WORKER_MESSAGES = [
  /worker (?:is )?unavailable/i,
  /worker stopped/i,
  /automation service is (?:temporarily )?unavailable/i,
  /no automation worker/i,
];

/**
 * Is this bill parked ONLY behind a stale pre-submit worker failure?
 * False for anything that already owns a claim number and for every real
 * manual-verification case.
 */
export function isStaleWorkerFailure(rec: VerificationCandidate): boolean {
  if (hasClaimEvidence(rec)) return false;
  if (requiresManualVerification(rec)) return false;

  const code = String(rec.failure_code ?? "");
  if ((STALE_WORKER_FAILURE_CODES as readonly string[]).includes(code)) return true;

  const msgs = [rec.submission_error, rec.submit_last_error].filter(Boolean).map(String);
  return msgs.some((m) => STALE_WORKER_MESSAGES.some((re) => re.test(m)));
}

export type ReconcileProof = {
  /** Where the proof came from — only the safe single-match engine today. */
  source: "sweep_single_match";
  /** The exact claim id the portal proved, must equal the claim being linked. */
  claim_id: string;
};

/**
 * May the audited writer reconcile this bill even though it is not in the
 * manual-verification state? Only with a matching portal proof.
 */
export function mayReconcileWithProof(
  rec: VerificationCandidate,
  proof: ReconcileProof | null | undefined,
  claimNumber: string,
): boolean {
  if (!proof) return false;
  if (proof.source !== "sweep_single_match") return false;
  if (String(proof.claim_id).trim() !== String(claimNumber).trim()) return false;
  return isStaleWorkerFailure(rec);
}

/** Fields cleared when — and only when — a proven claim is attached. */
export const STALE_WORKER_CLEARED_FIELDS = {
  requires_human_step: false,
  failure_code: null,
  failure_stage: null,
  submission_error: null,
  submit_last_error: null,
} as const;
