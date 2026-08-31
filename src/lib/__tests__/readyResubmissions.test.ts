import { describe, expect, it } from "vitest";
import {
  buildCorrectedCandidate,
  dedupeCorrected,
  matchesSearch,
  modifiersOf,
  readyTotal,
  sortCorrected,
} from "@/lib/readyResubmissions";
import {
  correctedSubmitAllowed,
  isOriginalClaimReuse,
  planCorrectedSubmit,
} from "@/lib/correctedSubmit";

const rates = [
  {
    id: "r1",
    provider_id: null,
    vehicle_type: "ambulatory",
    unit_type: "per_trip",
    procedure_code: "A0120",
    charge_amount: 20,
    place_of_service: "99",
    default_diagnosis_code: "R69",
  },
  {
    id: "r2",
    provider_id: null,
    vehicle_type: "ambulatory",
    unit_type: "per_mile",
    procedure_code: "S0215",
    charge_amount: 1.5,
    place_of_service: "99",
    default_diagnosis_code: "R69",
  },
] as any[];

function row(over: Record<string, any> = {}) {
  return {
    id: over["id"] ?? "sub-1",
    company_id: "co-1",
    original_trip_id: over["original_trip_id"] ?? "trip-1",
    original_claim_number: over["original_claim_number"] ?? "2326239001835",
    original_status: "denied",
    idempotency_key: over["idempotency_key"] ?? "acct|trip-1|2026-07-30|v2",
    draft_version: 3,
    status: "queued",
    submitted_at: "2026-08-01T00:00:00Z",
    draft_snapshot: {
      service_date: over["service_date"] ?? "2026-07-30",
      passenger_name: over["passenger_name"] ?? "Jane Doe",
      medicaid_id: "A123456789",
      driver_name: "Sam Driver",
      vehicle_type: "ambulatory",
      miles_override: over["miles"] ?? 10,
      miles_override_reason: "Corrected from the trip report",
      legs: [
        { pickup_odometer: 0, dropoff_odometer: 5 },
        { pickup_odometer: 5, dropoff_odometer: 12 },
      ],

      lines: [{ line_index: 0 }],
      ...(over["snapshot"] ?? {}),
    },
    ...over,
  } as any;
}

describe("corrected resubmissions in Ready to Submit", () => {
  it("renders a card from the corrected draft, not the original trip", () => {
    const c = buildCorrectedCandidate({
      row: row(),
      lines: [{ resubmission_id: "sub-1", line_index: 0, modifiers: ["a1", "76"] }],
      rates,
      tripPdfPath: "paper/x.pdf",
    });
    expect(c.kind).toBe("corrected");
    expect(c.service_date).toBe("2026-07-30");
    expect(c.passenger_name).toBe("Jane Doe");
    expect(c.miles).toBe(10);
    expect(c.units).toBeGreaterThan(0);
    expect(c.total_amount).toBeGreaterThan(0);
    expect(c.modifiers).toEqual(["76", "A1"]);
    expect(c.has_attachment).toBe(true);
    // The original denied claim travels along as context only.
    expect(c.original_claim_number).toBe("2326239001835");
    expect(c.original_status).toBe("denied");
  });

  it("keeps the existing queued resubmissions visible with no data change", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({ id: `sub-${i}`, original_trip_id: `trip-${i}`, idempotency_key: `k-${i}` }),
    );
    const cards = dedupeCorrected(
      rows.map((r) => buildCorrectedCandidate({ row: r, lines: [], rates })),
    );
    expect(cards).toHaveLength(15);
    expect(cards.every((c) => c.kind === "corrected")).toBe(true);
  });

  it("dedupes strictly by resubmission id and idempotency key", () => {
    const a = buildCorrectedCandidate({ row: row({ id: "s1" }), lines: [], rates });
    const dupId = buildCorrectedCandidate({ row: row({ id: "s1" }), lines: [], rates });
    const dupKey = buildCorrectedCandidate({
      row: row({ id: "s2", original_trip_id: "trip-2" }),
      lines: [],
      rates,
    });
    expect(dedupeCorrected([a, dupId, dupKey])).toHaveLength(1);
  });

  it("combines corrected candidates into the Ready badge", () => {
    expect(readyTotal(4, 15)).toBe(19);
    expect(readyTotal(0, 0)).toBe(0);
  });

  it("searches and sorts corrected candidates", () => {
    const a = buildCorrectedCandidate({
      row: row({ id: "a", passenger_name: "Alice", service_date: "2026-07-01" }),
      lines: [],
      rates,
    });
    const b = buildCorrectedCandidate({
      row: row({ id: "b", passenger_name: "Bob", service_date: "2026-07-30" }),
      lines: [],
      rates,
    });
    expect(matchesSearch(a, "ali")).toBe(true);
    expect(matchesSearch(a, "bob")).toBe(false);
    expect(matchesSearch(a, "2326239001835")).toBe(true);
    expect(sortCorrected([a, b], "date_desc")[0]!.id).toBe("b");
    expect(sortCorrected([a, b], "date_asc")[0]!.id).toBe("a");
    expect(sortCorrected([b, a], "passenger")[0]!.id).toBe("a");
  });

  it("collects modifiers from the saved service lines", () => {
    expect(
      modifiersOf([
        { resubmission_id: "s", modifiers: ["76"] },
        { resubmission_id: "s", modifiers: ["76", "tn"] },
      ]),
    ).toEqual(["76", "TN"]);
  });
});

describe("corrected submit safety", () => {
  const records = new Map([["trip-1", "rec-1"]]);

  it("sends nothing without an explicit confirmation", () => {
    expect(correctedSubmitAllowed(undefined).ok).toBe(false);
    expect(correctedSubmitAllowed("yes").ok).toBe(false);
    expect(correctedSubmitAllowed(true).ok).toBe(true);
  });

  it("maps a ready resubmission to exactly one billing record", () => {
    const plan = planCorrectedSubmit([{ id: "s1", status: "queued", original_trip_id: "trip-1" }], records);
    expect(plan.recordIds).toEqual(["rec-1"]);
    expect(plan.pairs[0]).toMatchObject({ resubmission_id: "s1", billing_record_id: "rec-1" });
  });

  it("produces one job for a double click / retry of the same selection", () => {
    const plan = planCorrectedSubmit(
      [
        { id: "s1", status: "queued", original_trip_id: "trip-1" },
        { id: "s1", status: "queued", original_trip_id: "trip-1" },
      ],
      records,
    );
    expect(plan.recordIds).toEqual(["rec-1"]);
  });

  it("never sends two corrected claims for the same trip", () => {
    const plan = planCorrectedSubmit(
      [
        { id: "s1", status: "queued", original_trip_id: "trip-1" },
        { id: "s2", status: "queued", original_trip_id: "trip-1" },
      ],
      records,
    );
    expect(plan.recordIds).toEqual(["rec-1"]);
    expect(plan.skipped[0]?.code).toBe("duplicate_selection");
  });

  it("refuses anything that is not in the Ready state", () => {
    const plan = planCorrectedSubmit(
      [{ id: "s1", status: "draft", original_trip_id: "trip-1" }],
      records,
    );
    expect(plan.recordIds).toEqual([]);
    expect(plan.skipped[0]?.code).toBe("not_ready");
  });

  it("keeps the corrected draft when the bill is gone (failure loses no work)", () => {
    const plan = planCorrectedSubmit(
      [{ id: "s1", status: "queued", original_trip_id: "trip-missing" }],
      records,
    );
    expect(plan.recordIds).toEqual([]);
    expect(plan.skipped[0]?.code).toBe("no_billing_record");
  });

  it("never reuses the original claim number as the new confirmation", () => {
    expect(isOriginalClaimReuse("2326239001835", "2326239001835")).toBe(true);
    expect(isOriginalClaimReuse("2326239009999", "2326239001835")).toBe(false);
    expect(isOriginalClaimReuse(null, "2326239001835")).toBe(false);
  });
});
