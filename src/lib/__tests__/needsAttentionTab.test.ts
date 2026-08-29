import { describe, expect, it } from "vitest";
import {
  needsAttention,
  isReadyToSubmit,
  partitionBillingRows,
  attentionReasonLabel,
} from "@/lib/needsAttention";
import { decideCorrectedSave } from "@/lib/correctedSave";
import { planLegSync } from "@/lib/odometerLegs";

describe("Needs Attention tab membership", () => {
  it("keeps plain approved bills in Ready to Submit", () => {
    const rec = { status: "approved" };
    expect(needsAttention(rec)).toBe(false);
    expect(isReadyToSubmit(rec)).toBe(true);
  });

  it("captures needs_fix, human-step flags and manual-verification cases", () => {
    expect(needsAttention({ status: "needs_fix" })).toBe(true);
    expect(needsAttention({ status: "approved", requires_human_step: true })).toBe(true);
    expect(needsAttention({ status: "approved", robot_last_status: "NEEDS_HUMAN_LOOKUP" })).toBe(
      true,
    );
    expect(needsAttention({ status: "approved", failure_code: "ambiguous_outcome" })).toBe(true);
  });

  it("captures approved bills that still carry a live blocking error", () => {
    expect(
      needsAttention({ status: "approved", submission_error: "Medicaid ID is not valid." }),
    ).toBe(true);
  });

  it("never pulls submitted or paid claims into the worklist", () => {
    expect(needsAttention({ status: "submitted", state_confirmation_number: "2326239001622" })).toBe(
      false,
    );
    expect(needsAttention({ status: "submitted", requires_human_step: true })).toBe(false);
    expect(needsAttention({ status: "paid", requires_human_step: true })).toBe(false);
  });

  it("leaves bills that are live in the queue alone unless a human owns them", () => {
    expect(needsAttention({ status: "queued" })).toBe(false);
    expect(needsAttention({ status: "submitting" })).toBe(false);
    expect(needsAttention({ status: "queued", requires_human_step: true })).toBe(true);
  });

  it("splits a fetched page into the two stages with no row lost or duplicated", () => {
    const rows = [
      { id: "a", status: "approved" },
      { id: "b", status: "needs_fix" },
      { id: "c", status: "approved", requires_human_step: true },
      { id: "d", status: "approved" },
    ];
    const { ready, attention } = partitionBillingRows(rows);
    expect(ready.map((r) => r.id)).toEqual(["a", "d"]);
    expect(attention.map((r) => r.id)).toEqual(["b", "c"]);
    expect(ready.length + attention.length).toBe(rows.length);
  });

  it("gives every attention row a plain-English reason", () => {
    expect(attentionReasonLabel({ status: "needs_fix" })).toMatch(/correct it/i);
    expect(attentionReasonLabel({ status: "approved", robot_last_status: "SUBMITTED_UNVERIFIED" }))
      .toMatch(/verification/i);
  });
});

describe("editing a Needs Attention bill", () => {
  const missingData = {
    status: "needs_fix",
    submission_error: "Submission blocked: odometer readings give 0 billable miles",
  };

  it("becomes billable and leaves Needs Attention once the preflight passes", () => {
    const outcome = decideCorrectedSave(missingData, { ok: true, issues: [] });
    expect(outcome.kind).toBe("ready");
    expect(outcome.status).toBe("approved");
    // The saved row is what the tab reads back: it is now Ready to Submit.
    expect(needsAttention({ status: "approved", submission_error: null })).toBe(false);
    expect(isReadyToSubmit({ status: "approved", submission_error: null })).toBe(true);
  });

  it("stays in Needs Attention with the remaining reason when still invalid", () => {
    const outcome = decideCorrectedSave(missingData, {
      ok: false,
      issues: [{ message: "Submission blocked: odometer readings give 0 billable miles" }],
    });
    expect(outcome.kind).toBe("needs_fix");
    expect(outcome.reason).toMatch(/0 billable miles/);
    expect(needsAttention({ status: "needs_fix", submission_error: outcome.reason })).toBe(true);
  });

  it("never reopens a submitted or paid claim, even if the preflight passes", () => {
    const submitted = { status: "submitted", state_confirmation_number: "2326239001622" };
    const outcome = decideCorrectedSave(submitted, { ok: true, issues: [] });
    expect(outcome.kind).toBe("blocked");
    expect(outcome.status).toBeNull();
    expect(outcome.reason).toMatch(/claim number/i);
  });

  it("never clears an uncertain-submission guard through an edit", () => {
    const unverified = { status: "needs_fix", robot_last_status: "SUBMITTED_UNVERIFIED" };
    expect(decideCorrectedSave(unverified, { ok: true, issues: [] }).kind).toBe("blocked");
  });
});

describe("corrected odometer reaches the billed source of truth", () => {
  it("writes the single leg the preflight actually bills from", () => {
    expect(planLegSync([{ id: "leg-1", leg_index: 0 }], { start: 100, end: 112 })).toEqual({
      action: "update",
      legId: "leg-1",
      pickup_odometer: 100,
      dropoff_odometer: 112,
    });
  });

  it("does nothing when the trip has no legs — the trip columns are the source", () => {
    expect(planLegSync([], { start: 100, end: 112 })).toEqual({ action: "none" });
  });

  it("never guesses how to split a multi-leg trip and says so", () => {
    const plan = planLegSync(
      [
        { id: "l1", leg_index: 0 },
        { id: "l2", leg_index: 1 },
      ],
      { start: 100, end: 112 },
    );
    expect(plan.action).toBe("manual");
    expect(plan).toHaveProperty("reason", expect.stringMatching(/several odometer legs/i));
  });
});
