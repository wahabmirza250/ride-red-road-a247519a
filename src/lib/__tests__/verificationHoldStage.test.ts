import { describe, expect, it } from "vitest";
import {
  filterStage,
  flattenAttentionRow,
  splitAttentionCounts,
  stageOfFlatRow,
} from "@/lib/attentionCounts";
import { isReadyToSubmit } from "@/lib/needsAttention";

/** An approved Walla-style bill whose portal outcome was never verified. */
const uncertain = (robot: string, i: number) => ({
  id: `hold-${i}`,
  status: "approved",
  requires_human_step: false,
  submission_error: null,
  submit_last_error: null,
  failure_code: null,
  state_confirmation_number: null,
  medicaid_trips: {
    robot_last_status: robot,
    robot_confirmation_number: null,
    submitted_confirmation: null,
  },
});

const clean = (i: number) => ({
  id: `ready-${i}`,
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
});

const brokenData = (i: number) => ({
  ...clean(i),
  id: `fix-${i}`,
  status: "needs_fix",
  failure_code: "missing_required_data",
});

describe("Verification Hold is its own stage", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => uncertain("NEEDS_HUMAN_LOOKUP", i)),
    ...Array.from({ length: 8 }, (_, i) => uncertain("SUBMITTED_UNVERIFIED", i + 8)),
  ];

  it("puts all 16 uncertain rows in Verification Hold, none in Ready or Needs Attention", () => {
    expect(splitAttentionCounts(rows)).toEqual({
      ready_to_submit: 0,
      needs_attention: 0,
      verification_hold: 16,
    });
  });

  it("JOB_NOT_FOUND is held too", () => {
    expect(stageOfFlatRow(flattenAttentionRow(uncertain("JOB_NOT_FOUND", 99)))).toBe("hold");
  });

  it("renders exactly the counted rows in each stage", () => {
    const flat = rows.map(flattenAttentionRow);
    expect(filterStage(flat, "hold")).toHaveLength(16);
    expect(filterStage(flat, "ready")).toHaveLength(0);
    expect(filterStage(flat, "attention")).toHaveLength(0);
  });

  it("partitions mixed rows with no drops and no duplicates", () => {
    const mixed = [
      ...rows,
      ...Array.from({ length: 3 }, (_, i) => clean(i)),
      ...Array.from({ length: 2 }, (_, i) => brokenData(i)),
    ];
    const split = splitAttentionCounts(mixed);
    expect(split).toEqual({ ready_to_submit: 3, needs_attention: 2, verification_hold: 16 });
    expect(split.ready_to_submit + split.needs_attention + split.verification_hold).toBe(
      mixed.length,
    );
    const flat = mixed.map(flattenAttentionRow);
    const stages = flat.map(stageOfFlatRow);
    expect(stages.every((s) => s === "ready" || s === "attention" || s === "hold")).toBe(true);
  });

  it("Auto Pilot / submission selection can never pick a held row", () => {
    for (const r of rows.map(flattenAttentionRow)) {
      expect(isReadyToSubmit(r)).toBe(false);
      expect(stageOfFlatRow(r)).not.toBe("ready");
    }
  });
});
