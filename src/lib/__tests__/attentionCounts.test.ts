import { describe, expect, it } from "vitest";
import { splitAttentionCounts } from "@/lib/attentionCounts";
import { requiresManualVerification } from "@/lib/needsVerification";
import { needsAttention } from "@/lib/needsAttention";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r",
  status: "approved",
  requires_human_step: false,
  submission_error: null,
  submit_last_error: null,
  failure_code: null,
  state_confirmation_number: null,
  medicaid_trips: {
    robot_last_status: null,
    robot_confirmation_number: null,
    submitted_confirmation: null,
  },
  ...over,
});

describe("ready/attention counts use the rendered predicate", () => {
  it("counts a clean approved bill as ready", () => {
    expect(splitAttentionCounts([row()])).toEqual({
      ready_to_submit: 1,
      needs_attention: 0,
      verification_hold: 0,
    });
  });

  it("does NOT count an unverified-trip approved bill as ready", () => {
    const r = row({
      medicaid_trips: {
        robot_last_status: "NEEDS_HUMAN_LOOKUP",
        robot_confirmation_number: null,
        submitted_confirmation: null,
      },
    });
    expect(needsAttention(splitInput(r))).toBe(true);
    expect(splitAttentionCounts([r])).toEqual({
      ready_to_submit: 0,
      needs_attention: 0,
      verification_hold: 1,
    });
  });

  it("always counts needs_fix as attention", () => {
    expect(splitAttentionCounts([row({ status: "needs_fix", requires_human_step: true })])).toEqual({
      ready_to_submit: 0,
      needs_attention: 0,
      verification_hold: 1,
    });
  });
});

function splitInput(r: any) {
  return {
    status: r.status,
    requires_human_step: r.requires_human_step,
    robot_last_status: r.medicaid_trips.robot_last_status,
  } as any;
}

describe("pre-submit failures stay editable", () => {
  it("portal step-1 validation failure is not a verification case", () => {
    expect(
      requiresManualVerification({
        status: "needs_fix",
        requires_human_step: true,
        robot_last_status: "PORTAL_STEP1_VALIDATION_FAILED",
      }),
    ).toBe(false);
  });

  it("missing required data is not a verification case", () => {
    expect(
      requiresManualVerification({
        status: "needs_fix",
        requires_human_step: true,
        failure_code: "missing_required_data",
      }),
    ).toBe(false);
  });

  it("worker_unavailable before acceptance is not a verification case", () => {
    expect(
      requiresManualVerification({
        status: "needs_fix",
        requires_human_step: true,
        failure_code: "worker_unavailable",
      }),
    ).toBe(false);
  });

  it("post-acceptance lookup states stay quarantined", () => {
    expect(
      requiresManualVerification({
        status: "needs_fix",
        requires_human_step: true,
        failure_code: "needs_human_lookup",
        robot_last_status: "NEEDS_HUMAN_LOOKUP",
      }),
    ).toBe(true);
    expect(
      requiresManualVerification({
        status: "needs_fix",
        requires_human_step: true,
        failure_code: "worker_unavailable_after_acceptance",
      }),
    ).toBe(true);
  });
});
