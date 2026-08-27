import { describe, it, expect } from "vitest";
import { decideCorrectedSave, firstPreflightReason } from "@/lib/correctedSave";

const clean = {
  status: "needs_fix",
  // A plain data problem: no human-verification flag (that is now its own state).
  requires_human_step: false,
  submission_error: "Playwright: TimeoutError at page.click(...) huge stack",
  state_confirmation_number: null,
  robot_confirmation_number: null,
  submitted_confirmation: null,
  robot_last_status: null,
};

describe("corrected-save preflight decision", () => {
  it("never unblocks a bill flagged for manual HCPF verification", () => {
    const out = decideCorrectedSave({ ...clean, requires_human_step: true }, { ok: true, issues: [] });
    expect(out.kind).toBe("blocked");
  });

  it("moves to Ready to Submit when preflight passes and there is no claim evidence", () => {
    const out = decideCorrectedSave(clean, { ok: true, issues: [] });
    expect(out.kind).toBe("ready");
    expect(out.status).toBe("approved");
  });

  it("keeps needs_fix with a concise current reason when preflight still fails", () => {
    const out = decideCorrectedSave(clean, {
      ok: false,
      issues: [{ message: "Medicaid member ID is missing." }],
    });
    expect(out.kind).toBe("needs_fix");
    expect(out.reason).toBe("Medicaid member ID is missing.");
    expect(out.reason).not.toMatch(/Playwright/);
  });

  it("never unblocks a bill that already has a real claim number", () => {
    const out = decideCorrectedSave(
      { ...clean, state_confirmation_number: "1234567890" },
      { ok: true },
    );
    expect(out.kind).toBe("blocked");
    expect(out.reason).toMatch(/claim number/i);
  });

  it("never unblocks an ambiguous / unverified outcome even if preflight passes", () => {
    const out = decideCorrectedSave(
      { ...clean, robot_last_status: "SUBMITTED_UNVERIFIED" },
      { ok: true },
    );
    expect(out.kind).toBe("blocked");
  });

  it("never unblocks a bill that is live in the queue", () => {
    expect(decideCorrectedSave({ ...clean, status: "submitting" }, { ok: true }).kind).toBe(
      "blocked",
    );
    expect(decideCorrectedSave({ ...clean, status: "queued" }, { ok: true }).kind).toBe("blocked");
  });

  it("falls back to a generic reason when preflight gives no message", () => {
    expect(firstPreflightReason({ ok: false, issues: [] })).toMatch(/missing or invalid/i);
  });
});
