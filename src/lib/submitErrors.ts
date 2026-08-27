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

/**
 * PRE-SUBMIT PACING, NOT A FAILURE.
 *
 * The single-flight boundary refuses to open a second portal session for one
 * provider account. Nothing was sent, no browser was even opened, so the bill
 * is not "rejected": it simply was not this bill's turn. These rows must stay
 * `queued` with NO attempt burnt and never surface as Needs Fix.
 */
const ACCOUNT_BUSY_PATTERNS = [
  /already running on this (?:provider )?account/i,
  /account is busy/i,
  /single.?flight/i,
];

/**
 * BROWSER LAUNCH FAILURE — explicitly pre-submit.
 *
 * `browserType.launch` / `spawn EAGAIN` / `pthread_create` failures happen
 * before any page exists, so no HCPF page was ever opened and no claim can
 * have been created. It is a host-capacity (pacing) condition, safe to requeue
 * with a cooldown and no attempt burn. Anything that also smells ambiguous
 * (mentions Submit/Confirm) is deliberately excluded below.
 */
const LAUNCH_FAILURE_PATTERNS = [
  /browserType\.launch/i,
  /Failed to launch (?:the )?(?:browser|chromium|zygote)/i,
  /zygote/i,
  /pthread_create/i,
  /spawn\s+\S*\s*EAGAIN/i,
  /EAGAIN[^\n]*(?:spawn|launch|thread|fork)/i,
  /(?:spawn|launch|thread|fork)[^\n]*EAGAIN/i,
  /Resource temporarily unavailable/i,
  // No page ever existed → no portal interaction could have happened.
  /(?:browser|context)?\.?newPage\b/i,
  /newContext\b/i,
  /Failed to create (?:a )?(?:new )?(?:page|context|browser)/i,
  // "Target closed"/"browser has been closed" ONLY while still launching or
  // creating the first page — never a bare closed-target message.
  /(?:launch|newPage|newContext)[^\n]*(?:Target (?:closed|page[^\n]*closed)|browser has been closed|context or browser has been closed)/i,
  /before any portal interaction/i,
];


/**
 * Explicit worker statement that nothing reached the portal. Only trusted when
 * the same message carries no post-Submit/Confirm uncertainty.
 */
const NOTHING_SUBMITTED_PATTERNS = [
  /nothing was submitted/i,
];

/** Worker/browser-level failure: safe to retry later, never proof of a claim. */
export function isInfrastructureSubmitError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = String(msg);
  if (AMBIGUOUS_PATTERNS.some((re) => re.test(s))) return false;
  return INFRA_PATTERNS.some((re) => re.test(s));
}

/** Post-Submit/Confirm uncertainty — quarantined, never auto-recovered. */
export function isAmbiguousOutcomeMessage(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return AMBIGUOUS_PATTERNS.some((re) => re.test(String(msg)));
}

/** Single-flight pacing: the account was busy, nothing was submitted. */
export function isAccountBusyPreSubmitError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = String(msg);
  if (ACCOUNT_BUSY_PATTERNS.some((re) => re.test(s))) return true;
  // Legacy account-busy rows whose only marker is the explicit statement.
  if (isAmbiguousOutcomeMessage(s)) return false;
  return NOTHING_SUBMITTED_PATTERNS.some((re) => re.test(s));
}

/** Browser never launched: provably pre-submit, safe to requeue without burn. */
export function isBrowserLaunchFailure(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = String(msg);
  if (AMBIGUOUS_PATTERNS.some((re) => re.test(s))) return false;
  if (PORTAL_STEP1_PATTERNS.some((re) => re.test(s))) return false;
  return LAUNCH_FAILURE_PATTERNS.some((re) => re.test(s));
}

/** Pre-submit conditions that must requeue without consuming an attempt. */
export function isPreSubmitPacingCondition(msg: string | null | undefined): boolean {
  return isAccountBusyPreSubmitError(msg) || isBrowserLaunchFailure(msg);
}


export const INFRA_USER_MESSAGE =
  "Submission worker temporarily unavailable — queued for safe retry.";
export const ACCOUNT_BUSY_USER_MESSAGE =
  "Waiting for a submission slot on this provider account — nothing was submitted.";
export const LAUNCH_BUSY_USER_MESSAGE =
  "Waiting for automation capacity — nothing was submitted; this bill stays queued.";
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
  if (isAccountBusyPreSubmitError(raw)) return ACCOUNT_BUSY_USER_MESSAGE;
  if (isBrowserLaunchFailure(raw)) return LAUNCH_BUSY_USER_MESSAGE;
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
  | "worker_capacity"
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
  if (isAccountBusyPreSubmitError(s)) return { stage: "dispatch", code: "account_busy" };
  if (isBrowserLaunchFailure(s)) return { stage: "dispatch", code: "worker_capacity" };
  if (/required|missing|invalid|must be|not configured|no provider/i.test(s) && !isInfrastructureSubmitError(s))
    return { stage: "preflight", code: "missing_required_data" };
  if (isInfrastructureSubmitError(s)) return { stage: "worker", code: "worker_unavailable" };
  if (/fetch failed|network|ECONN|socket hang up|50\d/i.test(s))
    return { stage: "worker", code: "network" };
  return { stage: "portal_submit", code: "portal_rejected" };
}
