/**
 * WHY A BILL WAS NOT SENT (shared client + server vocabulary).
 *
 * "Skipped" on its own is meaningless to a biller and — worse — it hides the
 * one distinction that matters:
 *
 *   - a REAL submitted claim (we hold a portal claim number)  -> never resend,
 *   - an idempotency/duplicate collapse with live evidence     -> explain + link,
 *   - a stale or evidence-free skip                            -> must stay
 *     correctable; it may never permanently block a fixed bill.
 *
 * Nothing here retries or resubmits anything: it only labels outcomes.
 */

export type SkipCode =
  /** A portal claim number exists for this trip. Terminal — do not resend. */
  | "submitted_claim"
  /** Reached the portal, outcome unknown. Quarantined for verification. */
  | "unverified_outcome"
  /** Idempotency/duplicate collapse: the bill is already queued or sending. */
  | "already_queued"
  /** Flagged for human verification before any further automatic attempt. */
  | "needs_verification"
  /** Status is not submittable right now (e.g. draft, rejected). */
  | "not_submittable"
  /** Preflight found missing/invalid claim data. Correctable. */
  | "missing_data"
  /** Transient enqueue problem. Correctable / retryable by the biller. */
  | "enqueue_failed";

export type SkipEntry = {
  id: string;
  code: SkipCode;
  /** Raw server-side reason; kept for the detail line. */
  reason: string;
  /** Portal claim number when one is actually known. */
  claim?: string | null;
};

export type SkipDescription = {
  title: string;
  detail: string;
  /** True only when a real claim exists: the bill must never be resent. */
  permanent: boolean;
  /** True when correcting the bill can put it back in Ready to Submit. */
  correctable: boolean;
};

export function describeSkip(entry: SkipEntry): SkipDescription {
  switch (entry.code) {
    case "submitted_claim":
      return {
        title: entry.claim ? `Submitted — claim #${entry.claim}` : "Already submitted",
        detail:
          "This trip already has a claim at HCPF, so it was not sent again. Open the bill to see the claim.",
        permanent: true,
        correctable: false,
      };
    case "unverified_outcome":
      return {
        title: "Needs verification",
        detail:
          "A previous attempt reached the portal but its outcome was never verified. It stays quarantined until verification finishes — it is not resent automatically.",
        permanent: false,
        correctable: false,
      };
    case "already_queued":
      return {
        title: "Already in the queue",
        detail:
          "This bill was already queued or sending, so the duplicate request was ignored. Nothing was lost — it will finish on its own.",
        permanent: false,
        correctable: true,
      };
    case "needs_verification":
      return {
        title: "Needs verification",
        detail: "Flagged for a human check before another automatic attempt.",
        permanent: false,
        correctable: false,
      };
    case "missing_data":
      return {
        title: "Needs a correction",
        detail: entry.reason || "Required claim data is missing.",
        permanent: false,
        correctable: true,
      };
    case "not_submittable":
      return {
        title: "Not ready to submit",
        detail: entry.reason || "This bill is not in a submittable state.",
        permanent: false,
        correctable: true,
      };
    case "enqueue_failed":
    default:
      return {
        title: "Could not be queued",
        detail: entry.reason || "Please try again.",
        permanent: false,
        correctable: true,
      };
  }
}

/**
 * A skip may only permanently block a bill when we hold real evidence of a
 * submitted claim. Anything else must remain recoverable after a correction.
 */
export function blocksResubmission(entry: SkipEntry): boolean {
  return entry.code === "submitted_claim" && !!entry.claim;
}

/** One short line summarising a batch result for a toast. */
export function summarizeSkips(entries: SkipEntry[]): string {
  if (!entries.length) return "";
  const groups = new Map<string, { count: number; sample: SkipEntry }>();
  for (const e of entries) {
    const g = groups.get(e.code);
    if (g) g.count += 1;
    else groups.set(e.code, { count: 1, sample: e });
  }
  return Array.from(groups.values())
    .map(({ count, sample }) => `${count} × ${describeSkip(sample).title}`)
    .join(" · ");
}
