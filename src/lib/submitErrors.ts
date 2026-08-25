/**
 * SUBMISSION ERROR CLASSIFICATION + USER-SAFE MESSAGES.
 *
 * Client-safe (no server imports) so the billing UI and the queue worker agree
 * on what an error means.
 *
 * Three families matter:
 *   - INFRASTRUCTURE: the automation worker itself could not run a browser
 *     (Chromium spawn EAGAIN, page/browser closed, navigation timeouts). The
 *     portal was almost certainly never reached, but we still never *claim* it
 *     was: these are retried once the single-flight lock is released, after a
 *     cooldown.
 *   - AMBIGUOUS: something may already exist at the portal. Never auto-retried.
 *   - DATA: a real validation problem. Needs a human.
 *
 * Raw Playwright/Chromium text is diagnostics, not a user message: it is kept in
 * `submit_last_error` / the audit log and never rendered in a toast or table.
 */

const INFRA_PATTERNS = [
  /EAGAIN/i,
  /spawn(\s|ing)?\s*(chrom|browser|ETXTBSY|EAGAIN)?/i,
  /resource temporarily unavailable/i,
  /browser(\s|context)*(has been|was)?\s*closed/i,
  /Target (page|closed|crashed)/i,
  /page\.(goto|waitFor\w+|click)/i,
  /Protocol error/i,
  /net::ERR/i,
  /playwright|chromium|puppeteer/i,
  /browserType\.launch/i,
  /Navigation timeout/i,
  /Timeout \d+ms exceeded/i,
  /out of memory|ENOMEM|OOM/i,
];

const AMBIGUOUS_PATTERNS = [
  /confirm/i,
  /already submitted/i,
  /claim may exist/i,
  /SUBMITTED_UNVERIFIED/i,
  /SubmitClaimProf3/i,
  /ConfirmCmnButton/i,
  /after clicking (?:Submit|Confirm)/i,
];

const PORTAL_STEP1_PATTERNS = [
  /Still on Step 1 after clicking Continue/i,
  /Step\s*1[^\n]*(?:validation|required field|\* Indicates a required field)/i,
  /\* Indicates a required field/i,
];

/** Worker/browser-level failure: safe to retry later, never proof of a claim. */
export function isInfrastructureSubmitError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = String(msg);
  if (AMBIGUOUS_PATTERNS.some((re) => re.test(s))) return false;
  return INFRA_PATTERNS.some((re) => re.test(s));
}

export const INFRA_USER_MESSAGE =
  "Submission worker temporarily unavailable — queued for safe retry.";
export const AMBIGUOUS_USER_MESSAGE =
  "The portal outcome could not be verified — awaiting verification. This bill was NOT resubmitted automatically.";
export const PORTAL_STEP1_USER_MESSAGE =
  "Portal Step 1 validation failed — do not retry automatically.";

/** Portal Step 1 rebuilt/posted back with a missing required field. */
export function isPortalStep1ValidationFailure(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = String(msg);
  return PORTAL_STEP1_PATTERNS.some((re) => re.test(s));
}

/**
 * Strip stack traces / raw automation noise and return one short sentence that
 * is safe to show a biller.
 */
export function sanitizeSubmitError(msg: string | null | undefined): string {
  const raw = String(msg ?? "").trim();
  if (!raw) return "Submission could not be started. It is queued for a safe retry.";
  if (isPortalStep1ValidationFailure(raw)) return PORTAL_STEP1_USER_MESSAGE;
  if (isInfrastructureSubmitError(raw)) return INFRA_USER_MESSAGE;

  const firstLine =
    raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^at\s|^\s*\w+:\/\/|^Call log:|^\s*-\s/.test(l))[0] ?? raw;
  const clean = firstLine.replace(/\s+/g, " ").trim();
  return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
}

/* ---------------- Machine-readable failure taxonomy ---------------------- */

/**
 * A stable (stage, code) pair for every failure, persisted on the billing
 * record so the UI, metrics and support can reason about failures WITHOUT ever
 * rendering raw Playwright text.
 *
 * stage: where in the pipeline it broke.
 * code:  what broke, in a fixed vocabulary.
 */
export type SubmitFailureStage =
  | "preflight"
  | "dispatch"
  | "portal_step1"
  | "portal_submit"
  | "worker"
  | "reconcile"
  | "unknown";

export type SubmitFailureCode =
  | "missing_required_data"
  | "portal_step1_required_field"
  | "ambiguous_outcome"
  | "worker_unavailable"
  | "network"
  | "account_busy"
  | "portal_rejected"
  | "unknown";

export function classifySubmitFailure(
  msg: string | null | undefined,
): { stage: SubmitFailureStage; code: SubmitFailureCode } {
  const s = String(msg ?? "").trim();
  if (!s) return { stage: "unknown", code: "unknown" };
  if (isPortalStep1ValidationFailure(s))
    return { stage: "portal_step1", code: "portal_step1_required_field" };
  if (AMBIGUOUS_PATTERNS.some((re) => re.test(s)))
    return { stage: "portal_submit", code: "ambiguous_outcome" };
  if (/already running on this account|single.?flight|account is busy/i.test(s))
    return { stage: "dispatch", code: "account_busy" };
  if (/required|missing|invalid|must be|not configured|no provider/i.test(s) && !isInfrastructureSubmitError(s))
    return { stage: "preflight", code: "missing_required_data" };
  if (isInfrastructureSubmitError(s)) return { stage: "worker", code: "worker_unavailable" };
  if (/fetch failed|network|ECONN|socket hang up|50\d/i.test(s))
    return { stage: "worker", code: "network" };
  return { stage: "portal_submit", code: "portal_rejected" };
}
