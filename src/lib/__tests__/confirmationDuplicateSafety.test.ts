import { describe, expect, it } from "vitest";
import { canResendAfterCorrection } from "@/lib/resendGate";
import { needsAttention } from "@/lib/needsAttention";
import {
  classifyStatusCheckFailure,
  describeStatusCheckFailure,
} from "@/lib/statusCheckErrors";
import { CHECK_POLL_TIMEOUT_MS, pollIntervalMs } from "@/lib/claimStatusSync.server";

/** The confirmation numbers that must never be re-sent or erased. */
const CONFIRMED = ["2326238001728", "2326238001741", "2326241001037"];

describe("a confirmed claim can never be resubmitted", () => {
  it.each(CONFIRMED)("blocks resend for claim %s", (claim) => {
    const decision = canResendAfterCorrection({
      status: "needs_fix",
      state_confirmation_number: claim,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/already has a portal claim number/i);
  });

  it("still blocks when only the trip carries the confirmation", () => {
    expect(
      canResendAfterCorrection({ status: "approved", robot_confirmation_number: CONFIRMED[0] })
        .allowed,
    ).toBe(false);
  });
});

describe("a checker timeout is not an answer", () => {
  it("allows the checker at least 210 seconds", () => {
    expect(CHECK_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(210_000);
  });

  it("polls with exponential backoff, capped", () => {
    expect(pollIntervalMs(0)).toBeLessThan(pollIntervalMs(3));
    expect(pollIntervalMs(50)).toBeLessThanOrEqual(15_000);
  });

  it("treats 'still running' as infrastructure, never a portal outcome", () => {
    const detail = "checker job still running after 210s";
    expect(classifyStatusCheckFailure(detail)).toBe("infra");
    expect(describeStatusCheckFailure(detail)).toMatch(/temporarily unavailable/i);
    expect(describeStatusCheckFailure(detail)).not.toMatch(/missing|not found/i);
  });
});

describe("corrupt claims land in Needs Attention", () => {
  it("keeps an impossible-mileage bill out of Ready to Submit", () => {
    expect(needsAttention({ status: "approved", billed_miles: 16_432 })).toBe(true);
    expect(needsAttention({ status: "approved", billed_miles: 12 })).toBe(false);
  });

  it("never pulls a submitted claim back into the worklist", () => {
    expect(needsAttention({ status: "submitted", billed_miles: 16_432 })).toBe(false);
  });
});
