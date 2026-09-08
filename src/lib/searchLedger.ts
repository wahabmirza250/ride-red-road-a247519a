/**
 * DURABLE READ-ONLY CLAIM-SEARCH LEDGER (pure rules).
 *
 * The old flow started a BRAND NEW `/search-claim-by-trip` job on every tick
 * and polled it inside that one request. When the portal was slow the request
 * gave up, the next cron minute started another job, and one trip could burn
 * hundreds of portal sessions a day while writing an audit line each time.
 *
 * These rules make the search a durable, idempotent state machine:
 *   - at most ONE running search per bill; a running job is POLLED, never
 *     re-POSTed;
 *   - polling is bounded and backs off exponentially;
 *   - a 502 / timeout / unreachable checker is RETRYABLE, never evidence that
 *     no claim exists;
 *   - an audit line is written only when the outcome actually changes.
 *
 * Nothing here talks to HCPF; it only decides what the server should do next.
 */

export type SearchLedgerRow = {
  id?: string;
  job_id?: string | null;
  state?: string | null;
  started_at?: string | null;
  last_polled_at?: string | null;
  poll_attempts?: number | null;
  post_attempts?: number | null;
  next_attempt_at?: string | null;
};

/** Give up polling one job after this long and mark it lost (retryable). */
export const SEARCH_JOB_MAX_AGE_MS = 20 * 60 * 1000;
/** Hard ceiling on polls for a single job. */
export const SEARCH_JOB_MAX_POLLS = 40;
/** Stop re-POSTing a search for the same bill after this many failed starts. */
export const SEARCH_MAX_POSTS = 8;

const BASE_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

function ms(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Exponential backoff with a one-hour ceiling. */
export function searchBackoffMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** n);
}

/** Seconds between polls of a running job — short at first, then calmer. */
export function searchPollDelayMs(pollAttempts: number): number {
  const n = Math.max(0, Math.floor(pollAttempts));
  return Math.min(5 * 60 * 1000, 15_000 * 2 ** Math.min(n, 5));
}

export type SearchAction =
  | { kind: "poll"; jobId: string }
  | { kind: "start" }
  | { kind: "wait"; reason: string }
  | { kind: "exhausted"; reason: string };

/**
 * What should this tick do for one bill? The single place that guarantees we
 * never POST a second search while one is still running.
 */
export function nextSearchAction(
  row: SearchLedgerRow | null | undefined,
  now: number = Date.now(),
): SearchAction {
  if (!row) return { kind: "start" };
  const state = String(row.state ?? "");

  if (state === "running") {
    const started = ms(row.started_at ?? null) ?? now;
    const polls = Number(row.poll_attempts ?? 0);
    // Polled to death: stop, and let a person see it. Never loop.
    if (polls >= SEARCH_JOB_MAX_POLLS)
      return {
        kind: "exhausted",
        reason:
          "The read-only portal search never returned an answer. It stays on Verification Hold for a person — nothing was submitted.",
      };
    // The job itself is lost. That is retryable (bounded by post attempts), and
    // it is NEVER evidence that no claim exists.
    if (now - started > SEARCH_JOB_MAX_AGE_MS) return afterFailure(row, now);
    const due = ms(row.next_attempt_at ?? null);
    if (due !== null && due > now)
      return { kind: "wait", reason: "backing off before the next poll" };
    const jobId = String(row.job_id ?? "");
    if (!jobId) return { kind: "start" };
    return { kind: "poll", jobId };
  }

  // Terminal answers are kept; only a retryable error path restarts.
  if (state === "done" || state === "no_results" || state === "results")
    return { kind: "wait", reason: "already answered" };

  return afterFailure(row, now);
}

/** Retry path shared by a lost job and an errored search. */
function afterFailure(row: SearchLedgerRow, now: number): SearchAction {
  const posts = Number(row.post_attempts ?? 0);
  if (posts >= SEARCH_MAX_POSTS)
    return {
      kind: "exhausted",
      reason:
        "The read-only portal search has failed repeatedly. It stays on Verification Hold for a person — nothing was submitted.",
    };
  const due = ms(row.next_attempt_at ?? null);
  if (due !== null && due > now)
    return { kind: "wait", reason: "backing off before the next search" };
  return { kind: "start" };
}

/** Is this search answer proof, or just a failed attempt? */
export function isConclusive(outcome: {
  ok?: boolean;
  result_state?: string | null;
}): boolean {
  return Boolean(outcome?.ok) && Boolean(outcome?.result_state);
}
