import { describe, expect, it } from "vitest";
import { mergeDriverPayConfig, resolvePayPlan, payPlanIssues } from "@/lib/payPlans";

const legacyFrom = (row: { pay_type?: string; hourly_rate?: number | null; payout_percentage?: number | null }) => ({
  plan: (row.pay_type === "commission" ? "commission" : "hourly") as any,
  hourly_rate: row.hourly_rate ?? null,
  commission_percentage: row.payout_percentage ?? null,
  per_trip_amount: null,
  commission_base: (row.pay_type === "commission" ? "paid_claims" : null) as any,
  per_trip_source: null,
});

describe("driver pay percentage persistence", () => {
  it("keeps a saved percentage when the modern override only sets a plan", () => {
    const merged = mergeDriverPayConfig(
      { plan: "commission" } as any,
      legacyFrom({ pay_type: "commission", payout_percentage: 65 }),
    );
    const plan = resolvePayPlan({}, merged);
    expect(plan.plan).toBe("commission");
    expect(plan.commission_percentage).toBe(65);
    expect(plan.commission_base).toBe("paid_claims");
    expect(payPlanIssues(plan)).toEqual([]);
  });

  it("never overwrites an explicit override with the legacy value", () => {
    const merged = mergeDriverPayConfig(
      { plan: "commission", commission_percentage: 70 } as any,
      legacyFrom({ pay_type: "commission", payout_percentage: 65 }),
    );
    expect(resolvePayPlan({}, merged).commission_percentage).toBe(70);
  });

  it("still pays a percentage saved against a legacy per_hour row", () => {
    const merged = mergeDriverPayConfig(
      { plan: "commission" } as any,
      legacyFrom({ pay_type: "per_hour", payout_percentage: 50 }),
    );
    const plan = resolvePayPlan({}, merged);
    expect(plan.commission_percentage).toBe(50);
    expect(plan.commission_base).toBe("paid_claims");
  });

  it("resolves from the legacy row alone when no override exists at all", () => {
    const merged = mergeDriverPayConfig(null, legacyFrom({ pay_type: "commission", payout_percentage: 60 }));
    const plan = resolvePayPlan({}, merged);
    expect(plan.plan).toBe("commission");
    expect(plan.commission_percentage).toBe(60);
  });

  it("invents nothing when neither store has a rate", () => {
    expect(mergeDriverPayConfig(null, null)).toBeNull();
    const plan = resolvePayPlan({}, mergeDriverPayConfig({ plan: "commission" } as any, null));
    expect(plan.commission_percentage).toBeNull();
    expect(payPlanIssues(plan).length).toBeGreaterThan(0);
  });

  it("survives a save/reload round trip (override row written, read back merged)", () => {
    // What saveDriverPayPlan persists…
    const savedOverride = { plan: "commission", commission_percentage: 65, hourly_rate: null };
    // …and what the legacy Driver Pay screen keeps.
    const savedLegacy = legacyFrom({ pay_type: "commission", payout_percentage: 65 });
    const reloaded = resolvePayPlan({}, mergeDriverPayConfig(savedOverride as any, savedLegacy));
    expect(reloaded.commission_percentage).toBe(65);
    expect(reloaded.plan).toBe("commission");
  });

  it("applies the resolved percentage to paid-claim revenue", () => {
    const plan = resolvePayPlan(
      {},
      mergeDriverPayConfig({ plan: "commission" } as any, legacyFrom({ pay_type: "commission", payout_percentage: 65 })),
    );
    const revenue = 1000;
    expect(Math.round(revenue * (plan.commission_percentage! / 100) * 100) / 100).toBe(650);
  });
});
