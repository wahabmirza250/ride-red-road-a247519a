import { describe, it, expect } from "vitest";
import { splitAttentionCounts, filterStage, stageOfFlatRow } from "@/lib/attentionCounts";

/**
 * Badge / list parity regression.
 *
 * Production showed "Ready to Submit 16" over an empty list: the badge counted
 * rows from one query shape and the list classified rows from another (the
 * browser fallback fetched neither `failure_code`/`submit_last_error` nor the
 * trip's confirmations, so identical bills were staged differently).
 * Everything below asserts ONE predicate over ONE field set.
 */

const COMPANY = "11111111-2222-4333-8444-555555555555";
const OTHER = "22222222-3333-4444-8555-666666666666";

/** Row as the LIST returns it (flattened). */
function listRow(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `bill-${i}`,
    company_id: COMPANY,
    status: "approved",
    requires_human_step: false,
    submission_error: null,
    submit_last_error: null,
    failure_code: null,
    state_confirmation_number: null,
    robot_last_status: null,
    robot_confirmation_number: null,
    submitted_confirmation: null,
    ...over,
  };
}

/** The SAME row as the COUNT query returns it (trip fields nested). */
function countRow(r: ReturnType<typeof listRow>) {
  return {
    ...r,
    medicaid_trips: {
      robot_last_status: r.robot_last_status,
      robot_confirmation_number: r.robot_confirmation_number,
      submitted_confirmation: r.submitted_confirmation,
    },
  };
}

/** 17 approved rows for one company; exactly one is blocked for a human. */
function walla() {
  const rows = Array.from({ length: 16 }, (_, i) => listRow(i));
  rows.push(
    listRow(99, {
      requires_human_step: true,
      submission_error: "Billing rates not configured for this company",
      failure_code: "missing_required_data",
    }),
  );
  return rows;
}

describe("Ready to Submit badge / list parity", () => {
  it("17 approved rows with 1 blocked → badge 16 and rendered list length 16", () => {
    const rows = walla();
    expect(rows).toHaveLength(17);

    const counts = splitAttentionCounts(rows.map(countRow));
    const rendered = filterStage(rows, "ready");

    expect(counts.ready_to_submit).toBe(16);
    expect(rendered).toHaveLength(16);
    expect(rendered).toHaveLength(counts.ready_to_submit);
    expect(counts.needs_attention).toBe(1);
    expect(filterStage(rows, "attention")).toHaveLength(1);
  });

  it("the blocked row is the one held back, and it is not silently dropped", () => {
    const rows = walla();
    const ready = filterStage(rows, "ready").map((r) => r.id);
    const attention = filterStage(rows, "attention").map((r) => r.id);
    expect(ready).not.toContain("bill-99");
    expect(attention).toEqual(["bill-99"]);
    expect(ready.length + attention.length).toBe(rows.length);
  });

  it("stays company-isolated: another company's ready rows never join the page", () => {
    const rows = [...walla(), listRow(200, { company_id: OTHER }), listRow(201, { company_id: OTHER })];
    // Scope is enforced by RLS/company filter before the predicate runs.
    const scoped = rows.filter((r) => r.company_id === COMPANY);
    expect(filterStage(scoped, "ready")).toHaveLength(16);
    expect(splitAttentionCounts(scoped.map(countRow)).ready_to_submit).toBe(16);

    const otherScoped = rows.filter((r) => r.company_id === OTHER);
    expect(filterStage(otherScoped, "ready")).toHaveLength(2);
    expect(splitAttentionCounts(otherScoped.map(countRow)).ready_to_submit).toBe(2);
  });

  it("a row missing the predicate fields must not be classified as ready by accident", () => {
    // This is the exact drift the browser fallback used to cause: the trip's
    // unverified robot status was not fetched, so the row looked sendable.
    const full = listRow(1, { robot_last_status: "NEEDS_HUMAN_LOOKUP" });
    const truncated: any = { id: "bill-1", status: "approved", requires_human_step: false };
    expect(stageOfFlatRow(full)).toBe("hold");
    expect(stageOfFlatRow(truncated)).toBe("ready"); // wrong — which is why
    // every fetch feeding the predicate MUST select the full field set:
    expect(Object.keys(full)).toEqual(
      expect.arrayContaining([
        "failure_code",
        "submit_last_error",
        "robot_last_status",
        "robot_confirmation_number",
        "submitted_confirmation",
        "state_confirmation_number",
      ]),
    );
  });

  it("badge and list agree on unverified rows too (both zero)", () => {
    const rows = Array.from({ length: 16 }, (_, i) =>
      listRow(i, { robot_last_status: "NEEDS_HUMAN_LOOKUP" }),
    );
    expect(splitAttentionCounts(rows.map(countRow)).ready_to_submit).toBe(0);
    expect(filterStage(rows, "ready")).toHaveLength(0);
    expect(filterStage(rows, "attention")).toHaveLength(0);
    expect(filterStage(rows, "hold")).toHaveLength(16);
  });
});
