import { describe, expect, it } from "vitest";
import {
  calcClaim,
  isBillableLeg,
  MAX_BILLABLE_MILES_PER_LEG,
  partitionBillableLegs,
  type RateRow,
} from "@/lib/claimCalc";

const rates: RateRow[] = [
  { vehicle_type: "ambulatory", unit_type: "trip", procedure_code: "A0120", charge_amount: 10 },
  { vehicle_type: "ambulatory", unit_type: "mile", procedure_code: "S0215", charge_amount: 2 },
];

const leg = (miles: number) => ({ pickup_odometer: 1000, dropoff_odometer: 1000 + miles });
const claim = (miles: number[]) =>
  calcClaim({ legs: miles.map(leg), rates, vehicleType: "ambulatory" });

describe("52-mile billing eligibility is applied per leg", () => {
  it("allows the exact 52-mile boundary", () => {
    expect(MAX_BILLABLE_MILES_PER_LEG).toBe(52);
    expect(isBillableLeg(leg(52))).toBe(true);
    expect(claim([52])).toMatchObject({ miles: 52, units: 1, total: 114 });
  });

  it("excludes 52.01 miles instead of capping or splitting it", () => {
    expect(isBillableLeg(leg(52.01))).toBe(false);
    const result = claim([52.01]);
    expect(result.miles).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("allows two independently eligible 52-mile legs (104 total)", () => {
    expect(claim([52, 52])).toMatchObject({ miles: 104, units: 2, total: 228 });
  });

  it("bills only the eligible leg of a mixed 40 + 222 trip", () => {
    const parts = partitionBillableLegs([leg(40), leg(222)]);
    expect(parts.eligible).toHaveLength(1);
    expect(parts.excluded).toHaveLength(1);
    expect(claim([40, 222])).toMatchObject({ miles: 40, units: 1, total: 90 });
  });
});
