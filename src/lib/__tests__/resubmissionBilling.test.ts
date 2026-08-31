import { describe, expect, it } from "vitest";
import { normalizeSnapshot, type DraftSnapshot } from "@/lib/resubmissionDraft";
import {
  applyCalculatedLines,
  compareServiceLines,
  computeDraftBilling,
  money,
  resolveRate,
  type RateSetting,
} from "@/lib/resubmissionBilling";

// Production-shaped rates (values come from billing_rate_settings, never code).
const RATES: RateSetting[] = [
  {
    vehicle_type: "ambulatory",
    unit_type: "trip",
    procedure_code: "A0120",
    charge_amount: 12.15,
    place_of_service: "41",
    default_diagnosis_code: "R688",
  },
  {
    vehicle_type: "ambulatory",
    unit_type: "mile",
    procedure_code: "S0215",
    charge_amount: 2.74,
    place_of_service: "41",
    default_diagnosis_code: "R688",
  },
  {
    vehicle_type: "wheelchair_van",
    unit_type: "trip",
    procedure_code: "A0130",
    charge_amount: 25,
    place_of_service: "41",
    default_diagnosis_code: "R688",
  },
  {
    vehicle_type: "wheelchair_van",
    unit_type: "mile",
    procedure_code: "S0215",
    charge_amount: 3.1,
    place_of_service: "41",
    default_diagnosis_code: "R688",
  },
];

const leg = (i: number, a: number | null, b: number | null) => ({
  leg_index: i,
  leg_date: "2026-08-14",
  pickup_time: "09:00",
  pickup_address: "A",
  pickup_odometer: a,
  dropoff_time: "09:30",
  dropoff_address: "B",
  dropoff_odometer: b,
});

const snapshot = (over: Partial<DraftSnapshot> = {}): DraftSnapshot =>
  normalizeSnapshot({
    service_date: "2026-08-14",
    vehicle_type: "ambulatory",
    trip_kind: "one_way",
    legs: [leg(1, 100, 108)],
    lines: [],
    ...over,
  });

describe("computeDraftBilling", () => {
  it("bills one unit for a one-way trip", () => {
    const b = computeDraftBilling(snapshot(), RATES);
    expect(b.units).toBe(1);
    expect(b.miles).toBe(8);
    expect(b.base_charge).toBe(12.15);
    expect(b.mileage_charge).toBe(21.92);
    expect(b.total).toBe(34.07);
  });

  it("bills two units for a round trip with two valid legs", () => {
    const b = computeDraftBilling(
      snapshot({ trip_kind: "round_trip", legs: [leg(1, 100, 108), leg(2, 108, 116)] as any }),
      RATES,
    );
    expect(b.units).toBe(2);
    expect(b.miles).toBe(16);
    expect(b.warnings.some((w) => w.code === "units_vs_trip_kind")).toBe(false);
  });

  it("matches the verified production example: 2 units + 16 miles = $68.14", () => {
    const b = computeDraftBilling(
      snapshot({ trip_kind: "round_trip", legs: [leg(1, 0, 8), leg(2, 8, 16)] as any }),
      RATES,
    );
    expect(b.base_charge).toBe(24.3);
    expect(b.mileage_charge).toBe(43.84);
    expect(b.total).toBe(68.14);
    expect(money(b.total!)).toBe("$68.14");
  });

  it("supports more than two valid legs", () => {
    const b = computeDraftBilling(
      snapshot({ legs: [leg(1, 0, 5), leg(2, 5, 10), leg(3, 10, 12)] as any }),
      RATES,
    );
    expect(b.units).toBe(3);
    expect(b.miles).toBe(12);
  });

  it("ignores legs with reversed or missing odometers and warns", () => {
    const b = computeDraftBilling(
      snapshot({ trip_kind: "round_trip", legs: [leg(1, 100, 108), leg(2, 120, 110)] as any }),
      RATES,
    );
    expect(b.units).toBe(1);
    expect(b.miles).toBe(8);
    expect(b.warnings.some((w) => w.code === "invalid_legs")).toBe(true);
    expect(b.warnings.some((w) => w.code === "units_vs_trip_kind")).toBe(true);
  });

  it("uses a manual mileage override only when a reason is given", () => {
    const noReason = computeDraftBilling(snapshot({ miles_override: 30 }), RATES);
    expect(noReason.miles).toBe(8);
    expect(noReason.miles_source).toBe("odometer");
    expect(noReason.warnings.some((w) => w.code === "override_reason_missing")).toBe(true);

    const withReason = computeDraftBilling(
      snapshot({ miles_override: 30, miles_override_reason: "Detour for road closure" }),
      RATES,
    );
    expect(withReason.miles).toBe(30);
    expect(withReason.miles_source).toBe("override");
    expect(withReason.mileage_charge).toBe(82.2);
  });

  it("reports a missing rate instead of faking $0", () => {
    const b = computeDraftBilling(snapshot({ vehicle_type: "stretcher_van" }), RATES);
    expect(b.missing_rates).toEqual(["trip", "mile"]);
    expect(b.base_charge).toBeNull();
    expect(b.mileage_charge).toBeNull();
    expect(b.total).toBeNull();
    expect(money(b.total)).toBe("—");
  });

  it("resolves a different rate when the vehicle type changes", () => {
    const b = computeDraftBilling(snapshot({ vehicle_type: "wheelchair_van" }), RATES);
    expect(b.trip_rate?.procedure_code).toBe("A0130");
    expect(b.base_charge).toBe(25);
    expect(b.mileage_charge).toBe(24.8);
    expect(resolveRate(RATES, "wheelchair_van", "mile")?.rate).toBe(3.1);
  });

  it("counts custom lines once and never double counts configured codes", () => {
    const b = computeDraftBilling(
      snapshot({
        lines: [
          { line_index: 1, procedure_code: "A0120", units: 1, amount: 12.15 },
          { line_index: 2, procedure_code: "S0215", miles: 8, amount: 21.92 },
          { line_index: 3, procedure_code: "T2003", units: 1, amount: 5 },
        ] as any,
      }),
      RATES,
    );
    expect(b.extra_charge).toBe(5);
    expect(b.total).toBe(39.07);
  });
});

describe("service-line consistency", () => {
  const matching = snapshot({
    lines: [
      { line_index: 1, procedure_code: "A0120", units: 1, amount: 12.15 },
      { line_index: 2, procedure_code: "S0215", miles: 8, units: 8, amount: 21.92 },
    ] as any,
  });

  it("reports a match when lines equal the calculation", () => {
    const b = computeDraftBilling(matching, RATES);
    expect(compareServiceLines(matching, b).ok).toBe(true);
  });

  it("reports mismatches with exact differences and manual amount variance", () => {
    const snap = snapshot({
      lines: [
        { line_index: 1, procedure_code: "A0120", units: 2, amount: 30 },
      ] as any,
    });
    const b = computeDraftBilling(snap, RATES);
    const c = compareServiceLines(snap, b);
    expect(c.ok).toBe(false);
    expect(c.differences.some((d) => d.field === "units" && d.expected === 1)).toBe(true);
    expect(c.differences.some((d) => d.field === "missing" && d.procedure_code === "S0215")).toBe(
      true,
    );
    expect(c.manual_overrides[0]).toMatchObject({ procedure_code: "A0120", actual: 30, expected: 12.15 });
  });

  it("applies calculated values while preserving modifiers and custom lines", () => {
    const snap = snapshot({
      lines: [
        { line_index: 1, procedure_code: "A0120", units: 9, amount: 99, modifiers: ["76"] },
        { line_index: 2, procedure_code: "T2003", units: 1, amount: 5 },
      ] as any,
    });
    const b = computeDraftBilling(snap, RATES);
    const next = applyCalculatedLines(snap, b);

    const trip = next.lines.find((l) => l.procedure_code === "A0120")!;
    expect(trip.units).toBe(1);
    expect(trip.amount).toBe(12.15);
    expect(trip.modifiers).toEqual(["76"]);
    expect(trip.place_of_service).toBe("41");
    expect(trip.diagnosis_code).toBe("R688");

    const mile = next.lines.find((l) => l.procedure_code === "S0215")!;
    expect(mile.miles).toBe(8);
    expect(mile.amount).toBe(21.92);

    // Unrelated custom line survives untouched and is still counted once.
    const custom = next.lines.find((l) => l.procedure_code === "T2003")!;
    expect(custom.amount).toBe(5);
    expect(next.lines.map((l) => l.line_index)).toEqual([1, 2, 3]);

    const after = computeDraftBilling(next, RATES);
    expect(compareServiceLines(next, after).ok).toBe(true);
    expect(after.total).toBe(39.07);
  });

  it("does not compare when no rate is configured", () => {
    const snap = snapshot({ vehicle_type: "taxi" });
    const b = computeDraftBilling(snap, RATES);
    expect(compareServiceLines(snap, b).checked).toBe(false);
  });
});
