import { describe, it, expect } from "vitest";
import {
  blockingReasonLabel,
  canResendAfterCorrection,
  isQuarantinedOutcome,
} from "@/lib/resendGate";
import { isPreSubmitPacingCondition, sanitizeSubmitError } from "@/lib/submitErrors";

const ACCOUNT_BUSY =
  "Another portal session is already running on this provider account — the automation service is temporarily unavailable for this bill. Nothing was submitted; it stays queued.";
const LAUNCH = "browserType.launch: Failed to launch chromium: spawn EAGAIN";
const NEW_PAGE = "browser.newPage: Target page, context or browser has been closed";
const AMBIGUOUS =
  "Timeout 480000ms exceeded waiting for scheduled navigations to finish after clicking Confirm (ConfirmCmnButton)";

describe("corrected-resubmission gate", () => {
  it("corrected data with stale failure flags can be resent", () => {
    const d = canResendAfterCorrection({
      status: "needs_fix",
      requires_human_step: true,
      submission_error: "Missing driver name on the trip report",
      failure_code: "missing_required_data",
    });
    expect(d.allowed).toBe(true);
    expect(blockingReasonLabel({ status: "needs_fix", submission_error: "Missing driver name" })).toBe(
      "Needs a data correction before it can be sent again.",
    );
  });

  it("ambiguous post-Submit timeout stays blocked and quarantined", () => {
    const rec = { status: "needs_fix", requires_human_step: true, submission_error: AMBIGUOUS };
    expect(isQuarantinedOutcome(rec)).toBe(true);
    expect(canResendAfterCorrection(rec).allowed).toBe(false);
    expect(canResendAfterCorrection({ status: "needs_fix", robot_last_status: "SUBMITTED_UNVERIFIED" }).allowed).toBe(
      false,
    );
  });

  it("a bill with a portal claim number is never resendable here", () => {
    expect(
      canResendAfterCorrection({ status: "needs_fix", state_confirmation_number: "12345" }).allowed,
    ).toBe(false);
    expect(
      canResendAfterCorrection({ status: "needs_fix", robot_confirmation_number: "99" }).allowed,
    ).toBe(false);
  });

  it("live queue rows are not re-armed", () => {
    expect(canResendAfterCorrection({ status: "submitting" }).allowed).toBe(false);
    expect(canResendAfterCorrection({ status: "queued" }).allowed).toBe(false);
  });

  it("browser launch / newPage failures are pre-submit pacing, not Needs Fix", () => {
    for (const msg of [LAUNCH, NEW_PAGE, "pthread_create failed: Resource temporarily unavailable"]) {
      expect(isPreSubmitPacingCondition(msg)).toBe(true);
      expect(canResendAfterCorrection({ status: "needs_fix", submission_error: msg }).allowed).toBe(true);
      expect(blockingReasonLabel({ status: "needs_fix", submission_error: msg })).toBe(
        "Waiting for automation capacity — nothing was submitted.",
      );
    }
  });

  it("account-busy rows (incl. legacy 'Nothing was submitted') stay recoverable and never show raw traces", () => {
    expect(isPreSubmitPacingCondition(ACCOUNT_BUSY)).toBe(true);
    expect(canResendAfterCorrection({ status: "needs_fix", submission_error: ACCOUNT_BUSY }).allowed).toBe(
      true,
    );
    expect(sanitizeSubmitError(LAUNCH)).not.toMatch(/browserType|EAGAIN/);
    expect(sanitizeSubmitError(ACCOUNT_BUSY)).not.toMatch(/Playwright|chromium/i);
  });

  it("ambiguous text wins over an explicit 'nothing was submitted' claim", () => {
    const mixed = `${AMBIGUOUS} — nothing was submitted?`;
    expect(isPreSubmitPacingCondition(mixed)).toBe(false);
    expect(canResendAfterCorrection({ status: "needs_fix", submission_error: mixed }).allowed).toBe(false);
  });
});
