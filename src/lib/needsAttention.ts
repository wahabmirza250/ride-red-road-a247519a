/**
 * NEEDS ATTENTION — the human worklist, separated from the normal flow.
 *
 * "Ready to Submit" must only ever contain bills a biller can actually send.
 * Everything that needs a person first — a failed data check (needs_fix), a
 * bill flagged for a human step, or an uncertain HCPF outcome awaiting manual
 * verification — belongs in its own top-level stage so it can be worked
 * separately and never blocks or pollutes the send flow.
 *
 * Pure module (no data access): the workspace, the counts query and the tests
 * all share exactly this one definition of membership.
 */
import { requiresManualVerification, type VerificationCandidate } from "@/lib/needsVerification";
import { isClaimSane, sanityReason, type SanityCandidate } from "@/lib/claimSanity";

export type AttentionCandidate = VerificationCandidate &
  SanityCandidate & {
    status?: string | null;
    fix_notes?: string | null;
  };

/** Statuses that are handled by other stages and are never "attention". */
const ELSEWHERE = new Set([
  "queued",
  "submitting",
  "pending_submit",
  "submitted",
  "paid",
  "pending_review",
]);

/**
 * Does this bill need a human before it can move?
 *
 * Deliberately conservative: a submitted/paid claim, or a bill actively in the
 * queue, is never pulled into this list — reopening real claims is the one
 * thing this tab must never do.
 */
export function needsAttention(rec: AttentionCandidate): boolean {
  const status = String(rec.status ?? "");
  if (ELSEWHERE.has(status)) {
    // One exception: a bill sitting in the queue that has been handed to a
    // human is genuinely stuck and must be visible somewhere.
    return status !== "submitted" && status !== "paid" && Boolean(rec.requires_human_step);
  }
  if (status === "needs_fix" || status === "rejected") return true;
  if (rec.requires_human_step) return true;
  if (requiresManualVerification(rec)) return true;
  // Impossible mileage or an invalid/future/stale service date is never
  // auto-submittable — a person must look at it first.
  if (!isClaimSane(rec)) return true;
  // An approved bill still carrying a live blocking error is not "ready".
  return Boolean((rec.submission_error ?? "").trim());
}

/** A bill a biller can actually send right now. */
export function isReadyToSubmit(rec: AttentionCandidate): boolean {
  return String(rec.status ?? "") === "approved" && !needsAttention(rec);
}

/** Split one fetched page into the two stages. */
export function partitionBillingRows<T extends AttentionCandidate>(rows: T[]) {
  const attention: T[] = [];
  const ready: T[] = [];
  for (const r of rows) (needsAttention(r) ? attention : ready).push(r);
  return { attention, ready };
}

/** Why is this bill in the list? One short line, never a robot trace. */
export function attentionReasonLabel(rec: AttentionCandidate): string {
  if (requiresManualVerification(rec))
    return "Needs verification at HCPF before anything else can happen.";
  const sanity = sanityReason(rec);
  if (sanity) return sanity;
  if (rec.requires_human_step) return "Handed to a person — review before sending.";
  if (String(rec.status ?? "") === "needs_fix" || String(rec.status ?? "") === "rejected")
    return "Missing or invalid claim data — correct it, then it becomes billable.";
  return "Blocked by an unresolved error — open the bill for details.";
}
