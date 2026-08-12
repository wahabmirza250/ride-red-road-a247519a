import { describe, expect, it } from "vitest";
import { calcClaim, legMiles } from "@/lib/claimCalc";

const rates = [
  { vehicle_type: "ambulatory", unit_type: "trip", procedure_code: "A0100", charge_amount: 20 },
  { vehicle_type: "ambulatory", unit_type: "mile", procedure_code: "S0215", charge_amount: 1.5 },
];

describe("billed miles come only from odometer readings", () => {
  it("one way: dropoff minus pickup", () => {
    expect(legMiles({ pickup_odometer: 10000, dropoff_odometer: 10008 })).toBe(8);
  });

  it("round trip: sums both legs, ignoring the gap between legs", () => {
    const calc = calcClaim({
      legs: [
        { pickup_odometer: 10000, dropoff_odometer: 10008 }, // 8
        { pickup_odometer: 10025, dropoff_odometer: 10032 }, // 7
      ],
      rates,
      vehicleType: "ambulatory",
    });
    expect(calc.miles).toBe(15); // NOT 32 (raw start→end span)
    expect(calc.units).toBe(2);
    expect(calc.lines.find((l) => l.label === "Mileage charge")?.amount).toBe(22.5);
    expect(calc.total).toBe(62.5);
  });

  it("a bracketed OCR value like (8) never inflates miles", () => {
    const calc = calcClaim({
      legs: [{ pickup_odometer: 45210, dropoff_odometer: 45218 }],
      rates,
      vehicleType: "ambulatory",
    });
    expect(calc.miles).toBe(8);
    expect(calc.total).toBe(32);
  });
});
