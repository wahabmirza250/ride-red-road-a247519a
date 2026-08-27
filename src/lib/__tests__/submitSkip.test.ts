import { describe, it, expect } from "vitest";
import { blocksResubmission, describeSkip, summarizeSkips, type SkipEntry } from "@/lib/submitSkip";
import { canResendAfterCorrection } from "@/lib/resendGate";

const entry = (e: Partial<SkipEntry>): SkipEntry => ({ id: "1", code: "enqueue_failed", reason: "", ...e });

describe("skip / duplicate-protection labels", () => {
  it("a real claim number shows Submitted and permanently blocks resending", () => {
    const e = entry({ code: "submitted_claim", claim: "1234567", reason: "already submitted" });
    const d = describeSkip(e);
    expect(d.title).toBe("Submitted — claim #1234567");
    expect(d.permanent).toBe(true);
    expect(d.correctable).toBe(false);
    expect(blocksResubmission(e)).toBe(true);
    expect(canResendAfterCorrection({ status: "needs_fix", robot_confirmation_number: "1234567" }).allowed).toBe(
      false,
    );
  });

  it("an unverified outcome is never labelled as a submitted claim", () => {
    const e = entry({ code: "unverified_outcome", claim: null });
    expect(describeSkip(e).title).toBe("Needs verification");
    expect(describeSkip(e).permanent).toBe(false);
    expect(blocksResubmission(e)).toBe(false);
    // …but it still stays quarantined — no automatic resubmission.
    expect(canResendAfterCorrection({ status: "needs_fix", robot_last_status: "SUBMITTED_UNVERIFIED" }).allowed).toBe(
      false,
    );
  });

  it("idempotency collapse explains itself and never permanently blocks", () => {
    const e = entry({ code: "already_queued" });
    const d = describeSkip(e);
    expect(d.title).toBe("Already in the queue");
    expect(d.detail).toMatch(/Nothing was lost/);
    expect(d.permanent).toBe(false);
    expect(blocksResubmission(e)).toBe(false);
  });

  it("stale / evidence-free skips stay correctable", () => {
    for (const code of ["missing_data", "not_submittable", "enqueue_failed"] as const) {
      const e = entry({ code, reason: "Missing driver name" });
      expect(describeSkip(e).permanent).toBe(false);
      expect(describeSkip(e).correctable).toBe(true);
      expect(blocksResubmission(e)).toBe(false);
    }
    // Corrected bill with no claim evidence can go back to Ready to Submit.
    expect(
      canResendAfterCorrection({ status: "needs_fix", requires_human_step: true, submission_error: "Missing driver" })
        .allowed,
    ).toBe(true);
  });

  it("summary groups by reason", () => {
    const text = summarizeSkips([
      entry({ id: "a", code: "submitted_claim", claim: "9" }),
      entry({ id: "b", code: "already_queued" }),
      entry({ id: "c", code: "already_queued" }),
    ]);
    expect(text).toBe("1 × Submitted — claim #9 · 2 × Already in the queue");
  });
});
