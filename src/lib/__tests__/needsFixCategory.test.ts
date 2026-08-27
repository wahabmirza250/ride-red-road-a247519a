import { describe, it, expect } from "vitest";
import { needsFixSummary } from "@/lib/needsFixCategory";

describe("needs fix category", () => {
  it("shows Submitted with a claim number and blocks resend", () => {
    const s = needsFixSummary({ state_confirmation_number: "1234567890" });
    expect(s.category).toBe("submitted");
    expect(s.editable).toBe(false);
  });

  it("keeps an unverified outcome quarantined", () => {
    const s = needsFixSummary({ robot_last_status: "SUBMITTED_UNVERIFIED" });
    expect(s.category).toBe("unverified");
    expect(s.editable).toBe(false);
  });

  it("classifies pre-submit capacity failures as capacity, not a data fix", () => {
    const s = needsFixSummary({
      submission_error:
        "Another portal session is already running on this provider account — the automation service is temporarily unavailable for this bill. Nothing was submitted; it stays queued.",
    });
    expect(s.category).toBe("capacity");
  });

  it("never surfaces a raw stack trace as the reason", () => {
    const s = needsFixSummary({
      submission_error:
        "TimeoutError: page.click: Timeout 480000ms exceeded.\n at Object.<anonymous> (/app/submitClaim.js:120:5)",
    });
    expect(s.label).not.toMatch(/Timeout|submitClaim|anonymous/);
    expect(s.nextAction.length).toBeGreaterThan(0);
  });

  it("falls back to a review prompt when there is no error at all", () => {
    expect(needsFixSummary({}).category).toBe("unknown");
  });
});
