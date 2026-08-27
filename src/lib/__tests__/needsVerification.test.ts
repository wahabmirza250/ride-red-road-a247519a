import { describe, expect, it } from "vitest";
import {
  AUTO_VERIFY_UNAVAILABLE_MESSAGE,
  VERIFIED_NOT_SUBMITTED_STATUS,
  requiresManualVerification,
  sanitizeVerificationMessage,
  verificationPanel,
} from "@/lib/needsVerification";
import { canResendAfterCorrection } from "@/lib/resendGate";
import { needsFixSummary } from "@/lib/needsFixCategory";

describe("requiresManualVerification", () => {
  it("blocks every ambiguous failure code", () => {
    for (const failure_code of [
      "stale_interrupted_unverified",
      "inflight_ceiling_unverified",
      "ambiguous_outcome",
      "needs_human_lookup",
      "job_not_found",
      "worker_unavailable_after_acceptance",
    ]) {
      expect(requiresManualVerification({ failure_code })).toBe(true);
    }
  });

  it("blocks quarantined robot statuses", () => {
    for (const robot_last_status of ["SUBMITTED_UNVERIFIED", "NEEDS_HUMAN_LOOKUP", "JOB_NOT_FOUND"]) {
      expect(requiresManualVerification({ robot_last_status })).toBe(true);
    }
  });

  it("blocks a bare requires_human_step flag", () => {
    expect(requiresManualVerification({ requires_human_step: true })).toBe(true);
  });

  it("blocks ambiguous timeout text after job acceptance", () => {
    expect(
      requiresManualVerification({
        submission_error:
          "This submission never reported a final result and has exceeded the maximum processing time.",
      }),
    ).toBe(true);
    expect(
      requiresManualVerification({
        submit_last_error: "The worker stopped before the automation service confirmed the outcome.",
      }),
    ).toBe(true);
  });

  it("does NOT block pre-submit browser launch / capacity failures", () => {
    const cases = [
      "browserType.launch: spawn EAGAIN",
      "Failed to launch the browser: pthread_create resource temporarily unavailable",
      "browserContext.newPage: Target closed before any portal interaction",
    ];
    for (const submission_error of cases) {
      expect(requiresManualVerification({ submission_error })).toBe(false);
      expect(requiresManualVerification({ submission_error, requires_human_step: true })).toBe(
        false,
      );
    }
    expect(
      requiresManualVerification({ failure_code: "worker_capacity", requires_human_step: true }),
    ).toBe(false);
  });

  it("does not block a bill that already has a claim number", () => {
    expect(
      requiresManualVerification({
        robot_last_status: "SUBMITTED_UNVERIFIED",
        state_confirmation_number: "2026123",
      }),
    ).toBe(false);
  });

  it("clears once verified-not-submitted is recorded", () => {
    expect(requiresManualVerification({ robot_last_status: VERIFIED_NOT_SUBMITTED_STATUS })).toBe(
      false,
    );
  });
});

describe("blocked actions", () => {
  it("refuses move-to-ready for a verification case", () => {
    const d = canResendAfterCorrection({ failure_code: "inflight_ceiling_unverified" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/manual HCPF verification/i);
  });

  it("still allows move-to-ready after a genuine data correction", () => {
    const d = canResendAfterCorrection({ status: "needs_fix", submission_error: "Missing member ID" });
    expect(d.allowed).toBe(true);
  });

  it("labels the row as Needs verification, not Needs fix", () => {
    const s = needsFixSummary({ failure_code: "job_not_found" });
    expect(s.category).toBe("unverified");
    expect(s.editable).toBe(false);
    expect(s.label).toMatch(/verification/i);
  });

  it("keeps capacity failures as ordinary recoverable queue cases", () => {
    const s = needsFixSummary({ submission_error: "browserType.launch: spawn EAGAIN" });
    expect(s.category).toBe("capacity");
  });
});

describe("biller-safe messaging", () => {
  it("never shows raw HTML or Cannot POST bodies", () => {
    for (const raw of [
      "lookup HTTP 404: Cannot POST /search-claims",
      "<!DOCTYPE html><html><body>Cannot POST /search-claims</body></html>",
      "lookup unreachable: fetch failed",
    ]) {
      expect(sanitizeVerificationMessage(raw)).toBe(AUTO_VERIFY_UNAVAILABLE_MESSAGE);
    }
  });

  it("shows the member, DOS, account and job id in the panel", () => {
    const p = verificationPanel({
      medicaid_id: "D260223",
      passenger_name: "Jane Doe",
      service_date: "2026-07-30T15:00:00.000Z",
      provider_account: "acct:hfc-colorado",
      robot_job_id: "job-123",
      submission_error: "Cannot POST /search-claims",
    });
    expect(p.memberId).toBe("D260223");
    expect(p.serviceDate).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(p.providerAccount).toBe("acct:hfc-colorado");
    expect(p.jobId).toBe("job-123");
    expect(p.message).toBe(AUTO_VERIFY_UNAVAILABLE_MESSAGE);
    expect(p.instructions).toMatch(/Claims → Search Claims/);
  });
});
