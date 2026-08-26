/**
 * INCIDENT GUARD: a timeout is only automatically retryable when the worker
 * result explicitly proves the portal session died BEFORE Submit/Confirm.
 */
import { describe, it, expect } from "vitest";
import {
  hasExplicitPreSubmitFailureEvidence,
  looksLikeRetryableTimeout,
} from "@/lib/billingHelpers";
import { isTransientSubmitError, isAmbiguousSubmitError } from "@/lib/submissionQueue.server";
import { isPortalStep1ValidationFailure, classifySubmitFailure } from "@/lib/submitErrors";

const GENERIC = "Job timed out after 480s";
const SUBMIT_BOUNDARY =
  "Timeout 480000ms exceeded waiting for scheduled navigations to finish after clicking Confirm (ConfirmCmnButton) — click action done";
const PRE_SUBMIT =
  "stage=login: page.goto timed out — submit_reached=false, portal login page never loaded";
const STEP1 = "Still on Step 1 after clicking Continue. Errors: * Indicates a required field.";

describe("timeout evidence guard", () => {
  it("1) generic 480s timeout is never auto-retried", () => {
    expect(hasExplicitPreSubmitFailureEvidence(GENERIC)).toBe(false);
    expect(looksLikeRetryableTimeout(GENERIC)).toBe(false);
    expect(isTransientSubmitError(GENERIC)).toBe(false);
  });

  it("2) timeout mentioning Submit/Confirm goes to read-only reconciliation, not retry", () => {
    expect(hasExplicitPreSubmitFailureEvidence(SUBMIT_BOUNDARY)).toBe(false);
    expect(looksLikeRetryableTimeout(SUBMIT_BOUNDARY)).toBe(false);
    expect(isAmbiguousSubmitError(SUBMIT_BOUNDARY)).toBe(true);
    expect(isTransientSubmitError(SUBMIT_BOUNDARY)).toBe(false);
  });

  it("3) explicit pre-submit failure evidence stays safely recoverable", () => {
    expect(hasExplicitPreSubmitFailureEvidence(PRE_SUBMIT)).toBe(true);
    expect(looksLikeRetryableTimeout(PRE_SUBMIT)).toBe(true);
    expect(isTransientSubmitError(PRE_SUBMIT)).toBe(true);
    // Browser-level failure with no page driven at all.
    expect(
      isTransientSubmitError("browserType.launch failed: spawn EAGAIN"),
    ).toBe(true);
  });

  it("4) Step 1 validation failure never auto-retries", () => {
    expect(isPortalStep1ValidationFailure(STEP1)).toBe(true);
    expect(looksLikeRetryableTimeout(STEP1)).toBe(false);
    expect(isTransientSubmitError(STEP1)).toBe(false);
    expect(classifySubmitFailure(STEP1)).toEqual({
      stage: "portal_step1",
      code: "portal_step1_required_field",
    });
  });
});
