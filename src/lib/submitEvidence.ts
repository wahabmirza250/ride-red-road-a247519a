/**
 * PORTAL-OUTCOME EVIDENCE PREDICATES (pure, client-safe).
 *
 * These read a worker/portal error string and answer ONE question each:
 * "does this text prove where the run died relative to the Submit/Confirm
 * boundary?". They decide whether a bill may ever be retried automatically, so
 * they are deliberately conservative: anything that even hints the run reached
 * Submit is treated as possibly-submitted.
 *
 * They were extracted out of `billingHelpers.ts` (which imports server-only
 * request helpers) so that pure decision modules — and the billing UI — can
 * reuse the SAME rules instead of re-implementing near-copies.
 * `billingHelpers` re-exports every symbol here, so existing imports and the
 * test suite's `vi.mock("@/lib/billingHelpers")` stubs keep working unchanged.
 */

/**
 * FALSE-FAILURE GUARD.
 *
 * The HCPF portal's Confirm button posts back slowly. Playwright can click it
 * successfully and then time out only while waiting for the resulting
 * navigation to settle. The automation service reports that as a hard error,
 * but the claim IS live at the portal — retrying would double-submit.
 *
 * Detects "the Confirm click landed, the wait afterwards timed out".
 */
export function looksLikePostConfirmTimeout(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = String(raw);
  const clickedConfirm =
    /ConfirmCmnButton/i.test(t) || /confirm/i.test(t);
  const clickLanded = /click action done/i.test(t);
  const timedOutAfter =
    /waiting for scheduled navigations to finish/i.test(t) || /Timeout \d+ms exceeded/i.test(t);
  return clickedConfirm && clickLanded && timedOutAfter;
}

/**
 * Any timeout/closed-browser after the robot reached Submit/Confirm is an
 * ambiguous portal outcome. It must go to read-only verification, never back to
 * the submit queue, because a real claim may already exist.
 */
export function looksLikePossiblySubmittedTimeout(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = String(raw);
  const reachedSubmitOrConfirm =
    /ConfirmCmnButton|SubmitClaimProf3|Submit\s*Claim|Confirm Professional Claim|click(?:ed)?\s*(?:Submit|Confirm)/i.test(t) ||
    (/confirm|submit/i.test(t) && /click action done|after clicking|postback/i.test(t));
  const timeoutOrClosed =
    /Timeout \d+ms exceeded|timed out|navigation timeout|browser has been closed|Target page, context or browser has been closed|closed browser|page closed/i.test(t);
  return reachedSubmitOrConfirm && timeoutOrClosed;
}

/**
 * DEFINITIVELY NOT SUBMITTED.
 *
 * The portal rejected Step 3 (or the run aborted on the pre-Submit guard)
 * because no service line was committed, so no claim exists and the record is
 * safe to fix and retry. Must be checked BEFORE the post-confirm timeout
 * guard, which parks a record as possibly-submitted.
 */
export function looksLikeNoServiceLinesFailure(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = String(raw);
  return (
    /At least one Service Detail must be entered/i.test(t) ||
    /no committed service lines/i.test(t) ||
    /service line[s]? (?:were |was )?not committed/i.test(t) ||
    (/Did not reach Confirm page after Submit click/i.test(t) &&
      /SubmitClaimProf3/i.test(t))
  );
}

/** Status parked on a trip whose claim may already exist at the portal. */
export const UNVERIFIED_SUBMIT_STATUS = "SUBMITTED_UNVERIFIED";

/**
 * EXPLICIT PRE-SUBMIT FAILURE EVIDENCE.
 *
 * The ONLY thing that makes a failed portal run automatically retryable. The
 * worker/result must state, in machine-verifiable form, that the session died
 * BEFORE any Submit/Confirm boundary — e.g. a stage marker, `submit_reached=false`,
 * or a browser/launch level failure that means no page was ever driven.
 *
 * A bare "Job timed out after 480s" carries NO such evidence: the run could have
 * died anywhere, including after Submit. Those are parked, never re-queued.
 */
const PRE_SUBMIT_EVIDENCE_PATTERNS = [
  /\bstage\s*[:=]\s*["']?(?:launch|startup|login|signin|search|member_lookup|eligibility|step\s*1|step1|form_fill|navigate)\b/i,
  /\bsubmit_reached\s*[:=]\s*(?:false|0|no)\b/i,
  /\breached_submit\s*[:=]\s*(?:false|0|no)\b/i,
  /\bpre[_-]?submit(?:_failure)?\b/i,
  /failed before (?:the )?(?:Submit|Confirm)/i,
  /never (?:reached|clicked) (?:the )?(?:Submit|Confirm)/i,
  /browserType\.launch/i,
  /\bpage\.goto\b/i,
  /\b(?:EAGAIN|ENOMEM|resource temporarily unavailable)\b/i,
  /timed out (?:while )?(?:on|during|at) (?:the )?(?:portal )?(?:login|sign[- ]?in)\b/i,
];

export function hasExplicitPreSubmitFailureEvidence(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = String(raw);
  // Anything that even hints the run reached Submit/Confirm disqualifies it,
  // unless the message explicitly states the boundary was never crossed.
  const explicitlyBefore =
    /failed before (?:the )?(?:Submit|Confirm)/i.test(t) ||
    /never (?:reached|clicked) (?:the )?(?:Submit|Confirm)/i.test(t) ||
    /\b(?:submit_reached|reached_submit)\s*[:=]\s*(?:false|0|no)\b/i.test(t);
  if (looksLikePossiblySubmittedTimeout(t)) return false;
  if (/submit|confirm/i.test(t) && !explicitlyBefore) return false;
  return PRE_SUBMIT_EVIDENCE_PATTERNS.some((re) => re.test(t));
}

/** Max automatic retries the reconciler will fire for a timed-out bill. */
export const MAX_AUTO_TIMEOUT_RETRIES = 2;

/**
 * TRANSIENT TIMEOUT (safe to retry automatically).
 *
 * A timeout alone is NOT enough. The message must also carry explicit
 * pre-Submit failure evidence, proving HCPF could not have received the claim.
 * Data problems (required field, member/Medicaid ID lookup failures, validation
 * errors) stay excluded.
 */
export function looksLikeRetryableTimeout(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = String(raw);
  const dataProblem =
    /required field/i.test(t) ||
    /indicates a required/i.test(t) ||
    /medicaid/i.test(t) ||
    /member (?:id|not found|lookup)/i.test(t) ||
    /invalid/i.test(t) ||
    /not eligible|eligibility/i.test(t) ||
    /duplicate/i.test(t) ||
    looksLikePossiblySubmittedTimeout(t) ||
    /date .*future/i.test(t);
  if (dataProblem) return false;
  const timedOut =
    /timed out/i.test(t) ||
    /timeout \d+ms exceeded/i.test(t) ||
    /navigation timeout/i.test(t) ||
    /ETIMEDOUT/i.test(t);
  if (!timedOut) return false;
  return hasExplicitPreSubmitFailureEvidence(t);
}
