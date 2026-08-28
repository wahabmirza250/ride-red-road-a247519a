import { describe, expect, it } from "vitest";
import {
  canArchiveAttention,
  decideAttentionAction,
  extractPortalConfirmation,
  filterAttentionRows,
} from "@/lib/needsAttentionArchive";

describe("needs attention archive", () => {
  it("never archives an unverified portal outcome", () => {
    const d = decideAttentionAction({
      status: "needs_fix",
      requires_human_step: true,
      failure_code: "ambiguous_outcome",
      submission_error: "The portal outcome could not be verified — awaiting verification.",
    });
    expect(d.action).toBe("blocked");
  });

  it("never archives a lost-worker outcome even without requires_human_step", () => {
    expect(
      canArchiveAttention({
        status: "needs_fix",
        requires_human_step: false,
        failure_code: "worker_unavailable",
      }),
    ).toBe(false);
  });

  it("routes a known confirmation number to reconciliation instead of archiving", () => {
    const d = decideAttentionAction({
      status: "needs_fix",
      requires_human_step: true,
      submission_error: "Claim already exists at the portal (confirmation #2326239001622).",
    });
    expect(d.action).toBe("reconcile");
    expect(d).toMatchObject({ confirmation: "2326239001622" });
  });

  it("refuses to touch a bill that is still active", () => {
    for (const status of ["queued", "submitting"]) {
      expect(decideAttentionAction({ status }).action).toBe("blocked");
    }
  });

  it("archives a plain data error and a bill that already moved on", () => {
    expect(
      canArchiveAttention({
        status: "needs_fix",
        requires_human_step: false,
        submission_error: 'Units would not accept value "1314748".',
      }),
    ).toBe(true);
    expect(
      canArchiveAttention({ status: "paid", submission_error: "some stale error text" }),
    ).toBe(true);
  });

  it("extracts a confirmation only when it is unambiguous", () => {
    expect(extractPortalConfirmation("confirmation #2326239001622")).toBe("2326239001622");
    expect(extractPortalConfirmation("claim number: 232623900")).toBe("232623900");
    expect(extractPortalConfirmation("attempt 6 failed")).toBeNull();
    expect(extractPortalConfirmation(null)).toBeNull();
  });

  it("hides archived rows from the active list but can show them on request", () => {
    const rows = [{ id: "a" }, { id: "b", attention_archived_at: "2026-08-01T00:00:00Z" }];
    expect(filterAttentionRows(rows).map((r) => r.id)).toEqual(["a"]);
    expect(filterAttentionRows(rows, { includeArchived: true })).toHaveLength(2);
  });
});
