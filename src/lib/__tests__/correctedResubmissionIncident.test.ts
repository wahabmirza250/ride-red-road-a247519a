/**
 * Regression cover for the 2026-08-31 21:10 UTC corrected-resubmission
 * incident. Fifteen corrected claims were queued; none reached HCPF.
 *   - seven failed a mileage gate that measured the whole-day odometer span
 *     (first pickup -> last dropoff) instead of summing each corrected leg;
 *   - eight failed with "Could not be queued" because the corrected claim was
 *     pointed at the ORIGINAL denied billing record, which the database guard
 *     rightly refuses to re-queue once it owns a claim number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  correctedLegMiles,
  correctedMileageIssues,
  correctedTotalMiles,
} from "@/lib/correctedMileage";
import { planCorrectedSubmit } from "@/lib/correctedSubmit";

/** The exact production pairs, as (leg1, leg2) odometer readings. */
const CASES: Array<{ claim: string; legs: [number, number][]; miles: number; falseSpan: number }> = [
  { claim: "2326232001459", legs: [[10000, 10008], [10125, 10133]], miles: 16, falseSpan: 133 },
  { claim: "2326240001910", legs: [[52000, 52019], [52082, 52101]], miles: 38, falseSpan: 101 },
  { claim: "2326240001028", legs: [[30000, 30011], [30042, 30053]], miles: 22, falseSpan: 53 },
  { claim: "2326225001081", legs: [[8000, 8008], [8064, 8072]], miles: 16, falseSpan: 72 },
  { claim: "2326240002179", legs: [[45210, 45228], [58784, 58802]], miles: 36, falseSpan: 13592 },
  { claim: "2326233001065", legs: [[1000, 1007], [1129, 1136]], miles: 14, falseSpan: 136 },
  { claim: "2326238001133", legs: [[70000, 70010], [70084, 70094]], miles: 20, falseSpan: 94 },
];

const legsOf = (pairs: [number, number][]) =>
  pairs.map(([a, b], i) => ({ leg_index: i + 1, pickup_odometer: a, dropoff_odometer: b }));

describe("corrected mileage is per leg, never a whole-day span", () => {
  for (const c of CASES) {
    it(`claim ${c.claim}: bills ${c.miles} miles, not ${c.falseSpan}`, () => {
      const legs = legsOf(c.legs);
      expect(correctedTotalMiles(legs)).toBe(c.miles);
      expect(correctedMileageIssues({ legs })).toEqual([]);
      // The old, wrong measurement.
      const span = c.legs[c.legs.length - 1]![1] - c.legs[0]![0];
      expect(span).toBe(c.falseSpan);
    });
  }

  it("a same-day deadhead gap between legs is never billed", () => {
    const legs = legsOf([
      [45210, 45228],
      [58784, 58802],
    ]);
    expect(correctedLegMiles(legs[0]!)).toBe(18);
    expect(correctedLegMiles(legs[1]!)).toBe(18);
    expect(correctedTotalMiles(legs)).toBe(36);
  });

  it("only the leg that truly breaks the range is flagged, and it is named", () => {
    const legs = legsOf([
      [10000, 10008],
      [10100, 10199],
    ]);
    const issues = correctedMileageIssues({ legs });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.leg_index).toBe(2);
    expect(issues[0]!.message).toContain("Leg 2");
    expect(issues[0]!.message).toContain("99 miles");
  });

  it("a zero-mile leg is reported as a leg problem, not a claim total problem", () => {
    const issues = correctedMileageIssues({ legs: legsOf([[500, 500]]) });
    expect(issues.some((i) => i.code === "leg_miles_out_of_range" && i.leg_index === 1)).toBe(true);
  });

  it("service lines are validated against the number of corrected legs", () => {
    const legs = legsOf([
      [10000, 10008],
      [10100, 10108],
    ]);
    expect(
      correctedMileageIssues({ legs, lines: [{ line_index: 2, miles: 16 }] }),
    ).toEqual([]);
    const bad = correctedMileageIssues({ legs, lines: [{ line_index: 2, miles: 4000 }] });
    expect(bad[0]!.line_index).toBe(2);
  });
});

/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

function fakeDb(records: Row[]) {
  const state = { records: [...records], inserts: 0 };
  const api = {
    from(table: string) {
      if (table !== "billing_records") throw new Error("unexpected table " + table);
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => (filters.push((r) => r[col] === val), builder),
        is: (col: string, val: any) => (filters.push((r) => (r[col] ?? null) === val), builder),
        maybeSingle: async () => ({
          data: state.records.find((r) => filters.every((f) => f(r))) ?? null,
          error: null,
        }),
        insert: (row: Row) => {
          const clash = state.records.find(
            (r) => r.resubmission_id && r.resubmission_id === row.resubmission_id,
          );
          return {
            select: () => ({
              maybeSingle: async () => {
                if (clash) return { data: null, error: { message: "duplicate key" } };
                const created = { id: `corrected-${++state.inserts}`, ...row };
                state.records.push(created);
                return { data: created, error: null };
              },
            }),
          };
        },
      };
      return builder;
    },
  };
  return { api, state };
}

const ORIGINAL = {
  id: "orig-1",
  trip_id: "trip-1",
  trip_form_id: "form-1",
  company_id: "co-1",
  resubmission_id: null,
  status: "denied",
  state_confirmation_number: "2326232001459",
};

describe("planCorrectedSubmit resolves to corrected records only", () => {
  const rows = [
    { id: "res-1", status: "queued", original_trip_id: "trip-1" },
    { id: "res-2", status: "queued", original_trip_id: "trip-2" },
    { id: "res-3", status: "draft", original_trip_id: "trip-3" },
  ];

  it("maps each resubmission to its own corrected record", () => {
    const plan = planCorrectedSubmit(
      rows,
      new Map([
        ["res-1", "corrected-1"],
        ["res-2", "corrected-2"],
      ]),
    );
    expect(plan.recordIds).toEqual(["corrected-1", "corrected-2"]);
    expect(plan.skipped.map((s) => s.code)).toEqual(["not_ready"]);
  });

  it("never sends two corrected claims for the same trip", () => {
    const plan = planCorrectedSubmit(
      [
        { id: "res-1", status: "queued", original_trip_id: "trip-1" },
        { id: "res-9", status: "queued", original_trip_id: "trip-1" },
      ],
      new Map([
        ["res-1", "corrected-1"],
        ["res-9", "corrected-9"],
      ]),
    );
    expect(plan.recordIds).toEqual(["corrected-1"]);
    expect(plan.skipped[0]!.code).toBe("duplicate_selection");
  });

  it("reports, never silently drops, a resubmission with no prepared record", () => {
    const plan = planCorrectedSubmit(rows, new Map([["res-1", "corrected-1"]]));
    expect(plan.recordIds).toEqual(["corrected-1"]);
    expect(plan.skipped.map((s) => s.code).sort()).toEqual(["no_billing_record", "not_ready"]);
  });
});

/* ------------------------------------------------------------------ */

const submitSpy = vi.fn();
vi.mock("@/lib/submitSelection.server", () => ({
  submitSelectedRecords: (...a: any[]) => submitSpy(...a),
}));
vi.mock("@/lib/resubmissionLifecycle.server", () => ({
  claimResubmissionsForSubmit: async (_sb: any, _u: string, rows: any[]) => ({
    claimed: rows.map((r) => r.id),
    rejected: [],
  }),
  releaseResubmissionToReady: async () => {},
  writeResubmissionEvent: async () => ({ ok: true, error: null }),
}));
vi.mock("@/lib/correctedRecord.server", () => ({
  ensureCorrectedBillingRecord: async (_sb: any, a: any) => ({
    id: `corrected-${a.resubmissionId}`,
    created: true,
  }),
  findCorrectedRecord: async () => null,
}));

function resubDb(rows: Row[]) {
  const touched: string[] = [];
  const api: any = {
    from(table: string) {
      touched.push(table);
      const b: any = {
        select: () => b,
        eq: () => b,
        in: async () => ({ data: rows, error: null }),
        update: () => b,
      };
      return b;
    },
    touched,
  };
  return api;
}

describe("submitCorrectedResubmissions never touches the original bill", () => {
  beforeEach(() => submitSpy.mockReset());

  it("hands the corrected records — not the original ones — to the submit path", async () => {
    submitSpy.mockResolvedValue({ queued: 2, started: 2, skipped: [], failed: [] });
    const { submitCorrectedResubmissions } = await import("@/lib/correctedSubmit.server");
    const db = resubDb([
      {
        id: "res-1",
        company_id: "co-1",
        status: "queued",
        original_trip_id: "trip-1",
        original_claim_number: "2326232001459",
        idempotency_key: "k1",
        draft_snapshot: { service_date: "2026-08-12", legs: legsOf([[10000, 10008], [10125, 10133]]), lines: [] },
      },
      {
        id: "res-2",
        company_id: "co-1",
        status: "queued",
        original_trip_id: "trip-2",
        original_claim_number: "2326240002179",
        idempotency_key: "k2",
        draft_snapshot: { service_date: "2026-08-17", legs: legsOf([[45210, 45228], [58784, 58802]]), lines: [] },
      },
    ]);

    const res = await submitCorrectedResubmissions(db, "user-1", {
      resubmissionIds: ["res-1", "res-2"],
      confirm: true,
    });

    expect(res.queued).toBe(2);
    const call = submitSpy.mock.calls[0]![2];
    expect(call.ids).toEqual(["corrected-res-1", "corrected-res-2"]);
    // Corrected mileage context travels with the request, per leg.
    expect(correctedTotalMiles(call.corrected.get("corrected-res-2").legs)).toBe(36);
  });

  it("a 15-item batch reports each failure and still sends the rest", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      id: `res-${i}`,
      company_id: "co-1",
      status: i === 3 ? "draft" : "queued",
      original_trip_id: `trip-${i}`,
      original_claim_number: `claim-${i}`,
      idempotency_key: `k${i}`,
      draft_snapshot: { service_date: "2026-08-12", legs: legsOf([[100, 108]]), lines: [] },
    }));
    submitSpy.mockResolvedValue({
      queued: 13,
      started: 13,
      skipped: [{ id: "corrected-res-7", reason: "Leg 1 is 0 miles", code: "missing_data" }],
      failed: [],
    });
    const { submitCorrectedResubmissions } = await import("@/lib/correctedSubmit.server");
    const res = await submitCorrectedResubmissions(resubDb(rows), "user-1", {
      resubmissionIds: rows.map((r) => r.id),
      confirm: true,
    });
    expect(res.requested).toBe(15);
    expect(submitSpy.mock.calls[0]![2].ids).toHaveLength(14);
    expect(res.skipped.some((s) => s.code === "not_ready")).toBe(true);
    expect(res.skipped.some((s) => s.reason.includes("Leg 1 is 0 miles"))).toBe(true);
  });

  it("does nothing at all without an explicit confirmation", async () => {
    const { submitCorrectedResubmissions } = await import("@/lib/correctedSubmit.server");
    await expect(
      submitCorrectedResubmissions(resubDb([]), "user-1", {
        resubmissionIds: ["res-1"],
        confirm: false,
      }),
    ).rejects.toThrow();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
