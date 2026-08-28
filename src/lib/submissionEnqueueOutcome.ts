/**
 * WHY A SELECTED BILL DID (NOT) ENTER THE QUEUE — pure, client-safe.
 *
 * The old enqueue collapsed EVERY non-flip into "duplicate", so a bill that
 * silently failed to update looked identical to a genuine double click and the
 * batch reported "0 enqueued" with no reason at all. That is the bug behind a
 * submitted batch that never flowed.
 *
 * Duplicate now requires positive evidence: the row is really `queued` or
 * `submitting`. Anything else is a real, reportable failure.
 */

export type EnqueueOutcome =
  | { kind: "enqueued" }
  | { kind: "duplicate"; reason: string }
  | { kind: "failed"; reason: string };

export const ACTIVE_QUEUE_STATUSES = ["queued", "submitting"] as const;

export const isActiveQueueStatus = (status: unknown): boolean =>
  (ACTIVE_QUEUE_STATUSES as readonly string[]).includes(String(status ?? ""));

/** Classify one bill AFTER the compare-and-swap update was attempted. */
export function classifyEnqueueOutcome(input: {
  /** Rows returned by the update (`select("id")`). */
  updated: number;
  /** Postgres error code, if the update errored. */
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Status re-read straight after a no-op update, if we could read it. */
  statusAfter?: string | null;
  /** Whether the record could be read at all before the update. */
  readable?: boolean;
}): EnqueueOutcome {
  if (input.readable === false) {
    return {
      kind: "failed",
      reason: "This bill could not be read for submitting — please try again.",
    };
  }
  if (input.errorCode || input.errorMessage) {
    const code = String(input.errorCode ?? "");
    if (code === "23505" || /duplicate key/i.test(String(input.errorMessage ?? ""))) {
      return { kind: "duplicate", reason: "already queued or sending — the extra request was ignored" };
    }
    return { kind: "failed", reason: "Could not be queued — please try again." };
  }
  if (input.updated > 0) return { kind: "enqueued" };

  if (isActiveQueueStatus(input.statusAfter)) {
    return { kind: "duplicate", reason: "already queued or sending — the extra request was ignored" };
  }
  return {
    kind: "failed",
    reason: input.statusAfter
      ? `Could not be queued from status "${input.statusAfter}" — please try again.`
      : "Could not be queued — please try again.",
  };
}
