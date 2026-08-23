import { describe, expect, it } from "vitest";
import { computePlanPay, payPlanIssues, resolvePayPlan } from "@/lib/payPlans";

const company = {
  default_plan: "hourly" as const,
  hourly_rate: 20,
  commission_percentage: 30,
  per_trip_amount: 12,
  commission_base: "paid_claims" as const,
  per_trip_source: "completed_trips" as const,
};

describe("resolvePayPlan", () => {
  it("falls back to the company default when a driver has no override", () => {
    const p = resolvePayPlan(company, null);
    expect(p.plan).toBe("hourly");
    expect(p.hourly_rate).toBe(20);
    expect(p.overridden).toEqual([]);
  });

  it("overrides only the fields the driver row fills in", () => {
    const p = resolvePayPlan(company, { plan: "per_trip", per_trip_amount: 15 } as never);
    expect(p.plan).toBe("per_trip");
    expect(p.per_trip_amount).toBe(15);
    expect(p.hourly_rate).toBe(20);
    expect(p.overridden).toContain("plan");
  });

  it("defaults to hourly with no configuration at all", () => {
    expect(resolvePayPlan({}, null).plan).toBe("hourly");
  });
});

describe("payPlanIssues", () => {
  it("blocks commission until a supported revenue base is chosen", () => {
    const p = resolvePayPlan({ ...company, commission_base: "unset" }, { plan: "commission" } as never);
    expect(payPlanIssues(p).join(" ")).toMatch(/revenue/i);
  });

  it("blocks unsupported revenue bases", () => {
    const p = resolvePayPlan(
      { ...company, commission_base: "estimated_fares" },
      { plan: "commission" } as never,
    );
    expect(payPlanIssues(p).join(" ")).toMatch(/not supported/i);
  });

  it("requires a rate / amount for the plan in force", () => {
    expect(payPlanIssues(resolvePayPlan({ default_plan: "hourly" }, null))).toHaveLength(1);
    expect(payPlanIssues(resolvePayPlan({ default_plan: "per_trip" }, null))).toHaveLength(1);
    expect(payPlanIssues(resolvePayPlan(company, null))).toHaveLength(0);
  });
});

const work = { hours: 10.5, revenue_base: 1000, claim_count: 4, trip_count: 7, fuel: 25 };

describe("computePlanPay", () => {
  it("hourly pays hours only", () => {
    const r = computePlanPay(resolvePayPlan(company, null), work);
    expect(r.hourly_pay).toBe(210);
    expect(r.commission_amount).toBe(0);
    expect(r.trip_pay).toBe(0);
    expect(r.total).toBe(235);
  });

  it("commission pays a percentage of state-paid revenue", () => {
    const r = computePlanPay(resolvePayPlan(company, { plan: "commission" } as never), work);
    expect(r.commission_amount).toBe(300);
    expect(r.hourly_pay).toBe(0);
    expect(r.total).toBe(325);
  });

  it("per trip pays a fixed amount per completed trip", () => {
    const r = computePlanPay(resolvePayPlan(company, { plan: "per_trip" } as never), work);
    expect(r.trip_pay).toBe(84);
    expect(r.total).toBe(109);
  });

  it("hybrid hourly + commission adds both", () => {
    const r = computePlanPay(
      resolvePayPlan(company, { plan: "hybrid_hourly_commission" } as never),
      work,
    );
    expect(r.earnings).toBe(510);
    expect(r.total).toBe(535);
  });

  it("hybrid hourly + per trip adds both", () => {
    const r = computePlanPay(resolvePayPlan(company, { plan: "hybrid_hourly_per_trip" } as never), work);
    expect(r.earnings).toBe(294);
  });

  it("respects include_fuel and signed adjustments, cent-exact", () => {
    const r = computePlanPay(resolvePayPlan({ ...company, hourly_rate: 18.33 }, null), {
      ...work,
      hours: 3.33,
      include_fuel: false,
      bonus: -12.005,
    });
    expect(r.fuel).toBe(0);
    expect(r.hourly_pay).toBe(61.04);
    expect(r.total).toBe(49.04);
  });

  it("explains every number it produced", () => {
    const r = computePlanPay(resolvePayPlan(company, { plan: "hybrid_hourly_commission" } as never), work);
    expect(r.lines.map((l) => l.key)).toEqual(["hourly", "commission", "fuel"]);
    expect(r.lines.reduce((n, l) => n + l.amount, 0)).toBe(r.total);
  });
});
