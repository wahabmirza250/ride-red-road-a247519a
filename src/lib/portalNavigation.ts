/**
 * PRE-SUBMIT PORTAL NAVIGATION (login/home → Claims).
 *
 * Everything in this module happens strictly BEFORE any claim form entry, so a
 * failure here can never have created a claim at HCPF. Two jobs:
 *
 *  1. `CLAIMS_NAV_SPEC` — the ordered, redundant navigation strategy the
 *     automation worker should use to reach the Claims area instead of a single
 *     brittle `text=Claims` locator. It is sent with every submission payload
 *     as `navigation` so the worker can pick it up; workers that do not read it
 *     are unaffected (purely additive).
 *  2. `isPortalNavigationFailure` — classification of a navigation timeout as a
 *     PRE-SUBMIT condition: the bill stays recoverable/queued with no attempt
 *     burnt, and is never treated as submitted or ambiguous.
 *
 * Submit/Confirm behaviour, idempotency keys, account locking and duplicate
 * protection are untouched by anything here.
 */

export type ClaimsNavStrategy = {
  /** How the worker should locate the element. */
  kind: "role" | "link" | "button" | "menuitem" | "text" | "href" | "url";
  /** Accessible name / text / href fragment / URL, depending on `kind`. */
  value: string;
  /** Human note for worker logs. */
  note?: string;
};

/**
 * Ordered strategies, most robust first. Only navigation targets already used
 * by the existing implementation are included; no unverified deep URL is
 * guessed — the single `url` entry is the portal home the worker already lands
 * on after login, used to re-render a stalled SPA menu before retrying.
 */
export const CLAIMS_NAV_STRATEGIES: ClaimsNavStrategy[] = [
  { kind: "role", value: "link:Claims", note: "accessible link named Claims" },
  { kind: "role", value: "button:Claims", note: "menu trigger rendered as a button" },
  { kind: "menuitem", value: "Claims", note: "SPA menubar item" },
  { kind: "link", value: "Claims", note: "anchor text" },
  { kind: "href", value: "claim", note: "anchor whose href contains 'claim'" },
  { kind: "text", value: "Claims", note: "last-resort text locator (legacy behaviour)" },
];

/** Selectors that prove the portal shell finished rendering after login. */
export const PORTAL_READY_SELECTORS = [
  "role=navigation",
  "text=Log Out",
  "text=Provider",
  "#mainMenu",
];

export const CLAIMS_NAV_SPEC = {
  /** Wait for the portal shell before looking for the menu at all. */
  readySelectors: PORTAL_READY_SELECTORS,
  readyTimeoutMs: 45_000,
  /** Per-strategy timeout — short, because there are several strategies. */
  strategyTimeoutMs: 8_000,
  strategies: CLAIMS_NAV_STRATEGIES,
  /** Safe re-attempts of the whole navigation step, before any form entry. */
  maxAttempts: 3,
  /** Pause between attempts; a delayed SPA menu usually appears within this. */
  retryDelayMs: 3_000,
  /** Reload the already-loaded portal home between attempts (no new session). */
  reloadBetweenAttempts: true,
  /** Diagnostics on failure — screenshot + DOM snapshot, never shown to billers. */
  captureDiagnosticsOnFailure: true,
  /** Marker the worker must include in its error so we classify it correctly. */
  failureMarker: "portal_navigation",
} as const;

/**
 * Navigation-stage failure signatures. Deliberately narrow: they must all be
 * about reaching the Claims area, never about a claim form, Submit or Confirm.
 */
const NAV_FAILURE_PATTERNS = [
  /portal_navigation/i,
  /locator\(\s*['"`]?text=Claims/i,
  /waiting for (?:locator|selector)[^\n]*Claims/i,
  /(?:could not|couldn'?t|failed to|unable to)[^\n]*(?:find|open|reach|navigate to|click)[^\n]*Claims/i,
  /Claims (?:menu|link|tab|nav|navigation)[^\n]*(?:not found|timed out|never (?:appeared|rendered))/i,
  /portal (?:menu|shell|home)[^\n]*(?:never (?:rendered|loaded)|timed out)/i,
];

/** Anything that could mean a claim was created — excludes navigation class. */
const NOT_NAVIGATION_PATTERNS = [
  /confirm/i,
  /submit(?:ted)?\b/i,
  /SubmitClaimProf3/i,
  /SUBMITTED_UNVERIFIED/i,
  /NEEDS_HUMAN_LOOKUP/i,
  /JOB_NOT_FOUND/i,
  /claim (?:id|number)\s*[:#]/i,
  /Step\s*1/i,
  /\* Indicates a required field/i,
];

/**
 * True only for a provable pre-submit navigation failure between login and the
 * Claims area.
 */
export function isPortalNavigationFailure(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = String(msg);
  if (NOT_NAVIGATION_PATTERNS.some((re) => re.test(s))) return false;
  return NAV_FAILURE_PATTERNS.some((re) => re.test(s));
}

export const PORTAL_NAV_USER_MESSAGE =
  "The HCPF portal menu did not load in time — nothing was submitted. This bill stays queued and retries automatically.";
