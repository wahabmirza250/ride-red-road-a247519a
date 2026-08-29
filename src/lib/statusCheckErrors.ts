/**
 * Classifies a FAILED read-only claim-status check.
 *
 * Two very different things look the same to the caller:
 *
 *  - "infra": the checker service itself could not run (no browser process,
 *    service unreachable, HTTP 5xx, job timed out). The claim was never
 *    looked at. Burning an attempt here is wrong: exponential backoff pushes
 *    hundreds of healthy claims out to a 12-hour re-check because a service
 *    was briefly out of capacity, which is exactly how the queue went quiet.
 *
 *  - "portal": the portal answered, but not with something we recognise.
 *    That is a real inconclusive answer and does deserve backoff.
 *
 * Nothing here ever changes a billing status — the checker stays read-only.
 */

const INFRA_PATTERNS: RegExp[] = [
  /browsertype\.launch/i,
  /failed to launch/i,
  /\beagain\b/i,
  /spawn .*chrome/i,
  /out of memory|oom|enomem/i,
  /econnrefused|econnreset|etimedout|enotfound|socket hang up/i,
  /checker unreachable/i,
  /checker did not return a job id/i,
  /checker job timed out/i,
  // Any failure reported by the CHECKER SERVICE itself (queue state, empty
  // cause, crashed job) is infrastructure — the portal never answered.
  /checker job\b/i,
  /\bhttp (429|5\d\d)\b/i,
  /target closed|browser has been closed|session closed/i,
  /playwright/i,
];


export type StatusCheckFailureKind = "infra" | "portal";

export function classifyStatusCheckFailure(detail: string): StatusCheckFailureKind {
  const s = String(detail ?? "");
  return INFRA_PATTERNS.some((re) => re.test(s)) ? "infra" : "portal";
}

/** Flat, short re-check delay used when the checker service itself was down. */
export const INFRA_RETRY_MS = 5 * 60 * 1000;

/** Human-readable, never a raw stack trace. */
export function describeStatusCheckFailure(detail: string): string {
  if (classifyStatusCheckFailure(detail) === "infra") {
    return "The status-checking service was temporarily unavailable. Nothing was changed; this claim will be checked again shortly.";
  }
  return "The portal did not give a status we recognise. Nothing was changed; this claim will be checked again later.";
}
