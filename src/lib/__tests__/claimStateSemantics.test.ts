/**
 * A bill may only claim a portal outcome it can prove. Anything else reads
 * "Awaiting portal verification" — never Approved, Paid or Denied.
 */
import { describe, expect, it } from "vitest";
import {
  AWAITING_PORTAL_VERIFICATION_LABEL,
  isEvidenceBackedPortalState,
  presentClaimState,
} from "@/lib/claimStateSemantics";

const CLAIM = "2326241001170";

describe("presented claim state", () => {
  it("legacy 'approved' with no claim and no portal read is NOT approved", () => {
    const s = presentClaimState({
      status: "approved",
      state_confirmation_number: null,
      submitted_at: "2026-08-30T10:00:00Z",
    });
    expect(s.label).toBe(AWAITING_PORTAL_VERIFICATION_LABEL);
    expect(s.evidenceBacked).toBe(false);
  });

  it("a never-sent 'approved' bill is plain Ready to submit", () => {
    const s = presentClaimState({
      status: "approved",
      state_confirmation_number: null,
      submitted_at: null,
    });
    expect(s.label).toBe("Ready to submit");
    expect(s.key).toBe("ready");
  });

  it("'paid' without a claim number is not paid", () => {
    const s = presentClaimState({
      status: "paid",
      state_confirmation_number: null,
      portal_paid_amount: 54.8,
    });
    expect(s.label).toBe(AWAITING_PORTAL_VERIFICATION_LABEL);
  });

  it("'paid' with a claim number but no portal read is not paid", () => {
    const s = presentClaimState({ status: "paid", state_confirmation_number: CLAIM });
    expect(s.label).toBe(AWAITING_PORTAL_VERIFICATION_LABEL);
    expect(s.detail).toMatch(/has not been read back/i);
  });

  it("'paid' with a claim number and portal money is paid", () => {
    const s = presentClaimState({
      status: "paid",
      state_confirmation_number: CLAIM,
      portal_status_raw: "Paid",
      portal_paid_amount: 54.8,
    });
    expect(s.label).toBe("Paid");
    expect(s.evidenceBacked).toBe(true);
    expect(
      isEvidenceBackedPortalState({
        status: "paid",
        state_confirmation_number: CLAIM,
        portal_status_raw: "Paid",
      }),
    ).toBe(true);
    expect(isEvidenceBackedPortalState({ status: "paid", state_confirmation_number: null })).toBe(
      false,
    );
  });

  it("'submitted' needs a real 13-digit claim number, nothing less", () => {
    expect(
      presentClaimState({ status: "submitted", state_confirmation_number: "pending" }).label,
    ).toBe(AWAITING_PORTAL_VERIFICATION_LABEL);
    expect(presentClaimState({ status: "submitted", state_confirmation_number: CLAIM }).label).toBe(
      "Submitted",
    );
  });

  it("'denied' with a portal read keeps its meaning", () => {
    const s = presentClaimState({
      status: "denied",
      state_confirmation_number: CLAIM,
      portal_status_raw: "Denied",
    });
    expect(s.label).toBe("Denied");
  });

  it("workflow states are left completely alone", () => {
    for (const status of [
      "pending_review",
      "queued",
      "submitting",
      "needs_fix",
      "pending_submit",
    ]) {
      expect(presentClaimState({ status }).key).toBe("other");
    }
  });
});
