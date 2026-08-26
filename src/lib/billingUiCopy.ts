/**
 * Plain-English copy for the Billing workspace.
 *
 * Pure functions only — no data access, no side effects. Everything a normal
 * biller reads on the main workflow comes from here so the wording stays
 * consistent and stays free of implementation jargon (leases, single flight,
 * worker fleet). Technical detail belongs behind "Details".
 */

/** The four visible stages of the primary billing workflow. */
export const PRIMARY_STAGES = [
  { key: "pending_review", label: "Review" },
  { key: "ready_to_submit", label: "Ready to Submit" },
  { key: "awaiting_portal", label: "Processing" },
  { key: "submitted", label: "Submitted" },
] as const;

export type PrimaryStageKey = (typeof PRIMARY_STAGES)[number]["key"];

/** Secondary tools — still fully available, just out of the main flow. */
export const SECONDARY_TOOLS = [
  { key: "medical_review", label: "Medical Review" },
  { key: "claims_history", label: "Claims History" },
  { key: "payroll", label: "Payroll" },
  { key: "denied", label: "Denied / Resubmission" },
] as const;

export type SecondaryToolKey = (typeof SECONDARY_TOOLS)[number]["key"];

export const BILLING_PAGE_DESCRIPTION =
  "Review trips, submit approved claims, monitor processing, and track claim IDs.";

export const SUBMISSIONS_PAUSED_MESSAGE =
  "Submissions paused — no new claims will be sent. Status checks continue.";

/**
 * Why a claim is sitting in the queue. Deliberately says nothing about
 * "one at a time": different riders do process in parallel.
 */
export const WAITING_FOR_SLOT_MESSAGE =
  "Waiting for an available submission slot. Different riders can process in parallel.";

/** Plain-English label for a processing-stage record. */
export function processingStateLabel(
  status: string | null | undefined,
  opts: { requiresHumanStep?: boolean } = {},
): string {
  if (opts.requiresHumanStep) return "Needs verification";
  switch (status) {
    case "queued":
      return "Waiting for submission slot";
    case "submitting":
    case "running":
      return "Submitting to HCPF";
    case "pending_submit":
    case "verifying":
      return "Needs verification";
    default:
      return "Processing";
  }
}

/** One-line status strip shown to normal billers above the workflow. */
export function queueStatusStrip(input: {
  paused: boolean;
  processing: number;
  queued: number;
  needsAttention: number;
}): string {
  const head = input.paused ? "Automation paused" : "Automation running";
  return (
    `${head} · ${input.processing} processing · ${input.queued} queued · ` +
    `${input.needsAttention} needs attention`
  );
}

/** Toast copy when a single bill lands in the queue instead of starting now. */
export function queuedToastMessage(ahead: number): string {
  const n = Math.max(0, ahead);
  if (n === 0) return `Queued — starting shortly. ${WAITING_FOR_SLOT_MESSAGE}`;
  return `Queued behind ${n} claim${n === 1 ? "" : "s"}. It starts automatically. ${WAITING_FOR_SLOT_MESSAGE}`;
}
