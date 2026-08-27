/**
 * CORRECTED-SAVE DECISION (pure, shared by server + tests).
 *
 * Saving a correction never blindly marks a bill "Ready to Submit". After the
 * corrected data is persisted we re-run the same submission preflight against
 * it and combine the answer with the resend safety gate:
 *
 *   - real claim evidence            -> submitted, never resend
 *   - ambiguous / unverified outcome -> stays quarantined, never resend
 *   - preflight fails                -> stays needs_fix with ONE concise,
 *                                       current, actionable reason
 *   - preflight passes               -> approved (Ready to Submit), stale
 *                                       blocking flags cleared, NOT enqueued
 */
import { canResendAfterCorrection, type ResendCandidate } from "@/lib/resendGate";

export type CorrectedSaveOutcome =
  | { kind: "ready"; status: "approved"; reason: string }
  | { kind: "needs_fix"; status: "needs_fix"; reason: string }
  | { kind: "blocked"; status: null; reason: string };

export type PreflightLike = { ok: boolean; issues?: { message?: string | null }[] };

export function firstPreflightReason(pre: PreflightLike | null | undefined): string {
  const msg = pre?.issues?.find((i) => (i?.message ?? "").trim())?.message;
  return (msg ?? "").trim() || "Required claim data is still missing or invalid.";
}

export function decideCorrectedSave(
  rec: ResendCandidate,
  preflight: PreflightLike | null | undefined,
): CorrectedSaveOutcome {
  const gate = canResendAfterCorrection(rec);
  if (!gate.allowed) return { kind: "blocked", status: null, reason: gate.reason };
  if (!preflight?.ok)
    return { kind: "needs_fix", status: "needs_fix", reason: firstPreflightReason(preflight) };
  return {
    kind: "ready",
    status: "approved",
    reason: "Corrections saved and re-checked — this bill is ready to submit.",
  };
}
