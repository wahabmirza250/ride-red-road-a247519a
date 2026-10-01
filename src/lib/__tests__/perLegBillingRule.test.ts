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

describe("50-mile billing eligibility is applied per leg", () => {
  it("allows the exact 50-mile boundary", () => {
    expect(MAX_BILLABLE_MILES_PER_LEG).toBe(50);
    expect(isBillableLeg(leg(50))).toBe(true);
    expect(claim([50])).toMatchObject({ miles: 50, units: 1, total: 110 });
  });

  it("excludes 50.01 miles instead of capping or splitting it", () => {
    expect(isBillableLeg(leg(50.01))).toBe(false);
    const result = claim([50.01]);
    expect(result.miles).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("blocks a round trip over 50 total miles", () => {
    expect(claim([50, 50]).lines).toEqual([]);
  });

  it("blocks the whole bill instead of billing a smaller subset", () => {
    const parts = partitionBillableLegs([leg(40), leg(222)]);
    expect(parts.eligible).toHaveLength(1);
    expect(parts.excluded).toHaveLength(1);
    expect(claim([40, 222]).lines).toEqual([]);
  });
});
