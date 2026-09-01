import { describe, expect, it } from "vitest";
import {
  isPortalMoneyString,
  portalMoneyNumber,
  portalMoneyString,
  withPortalMoneyFields,
} from "@/lib/portalCurrency";
import { applyResubmissionOverrides } from "@/lib/resubmissionDraft";

describe("portal currency formatting", () => {
  it("kills floating-point artifacts from the 2026-09-01 incident", () => {
    expect(portalMoneyString(54.800000000000004)).toBe("54.80");
    expect(portalMoneyString(49.32000000000001)).toBe("49.32");
    expect(portalMoneyString(60.279999999999994)).toBe("60.28");
  });
  it("formats plain values and strings", () => {
    expect(portalMoneyString(60)).toBe("60.00");
    expect(portalMoneyString("$1,234.5")).toBe("1234.50");
    expect(portalMoneyString(0)).toBe("0.00");
    expect(portalMoneyString(-2.005)).toBe("-2.01");
  });
  it("never invents money", () => {
    expect(portalMoneyString(null)).toBeNull();
    expect(portalMoneyString("")).toBeNull();
    expect(portalMoneyString("abc")).toBeNull();
    expect(portalMoneyNumber(54.800000000000004)).toBe(54.8);
  });
  it("recognizes portal-safe text", () => {
    expect(isPortalMoneyString("54.80")).toBe(true);
    expect(isPortalMoneyString("54.8")).toBe(false);
    expect(isPortalMoneyString(54.8 as any)).toBe(false);
  });
  it("adds a numeric twin without dropping other keys", () => {
    const out = withPortalMoneyFields({ amount: 1.005, units: 2 }, ["amount"]);
    expect(out.amount).toBe("1.01");
    expect((out as any).amount_value).toBe(1.01);
    expect(out.units).toBe(2);
  });
});

describe("corrected payload money", () => {
  const snapshot = {
    service_date: "2026-08-10",
    medicaid_id: "G645382",
    trip_kind: "round_trip",
    legs: [{ leg_index: 0, pickup_odometer: 100, dropoff_odometer: 110 }],
    lines: [
      { line_index: 0, procedure_code: "A0120", units: 1, miles: 5, amount: 54.800000000000004 },
      { line_index: 1, procedure_code: "S0215", units: 10, miles: 5, amount: 49.32000000000001 },
    ],
  };

  it("types every charge amount as exact currency text", () => {
    const out: any = applyResubmissionOverrides({ charge_amount: 12.3400000001 }, snapshot);
    expect(out.service_lines.map((l: any) => l.amount)).toEqual(["54.80", "49.32"]);
    expect(out.service_lines.map((l: any) => l.charge_amount)).toEqual(["54.80", "49.32"]);
    expect(out.charge_amount).toBe("12.34");
    expect(out.total_charge).toBe("104.12");
    for (const l of out.service_lines) expect(isPortalMoneyString(l.amount)).toBe(true);
  });
});
