/**
 * Extensible driver compensation model.
 *
 * A company sets defaults; a driver row overrides only the fields it fills in.
 * Every plan is resolved to one shape and priced by one pure function, so
 * adding a plan later means touching this file only.
 *
 * Nothing here touches the database or the clock — all inputs are passed in,
 * so a payout can always be recomputed and audited after the fact.
 */

import { round2 } from "@/lib/payrollCalc";

export const PAY_PLANS = [
  "hourly",
  "commission",
  "per_trip",
  "hybrid_hourly_commission",
  "hybrid_hourly_per_trip",
] as const;
export type PayPlan = (typeof PAY_PLANS)[number];

/** Revenue a commission percentage is applied to. */
export const COMMISSION_BASES = ["unset", "paid_claims", "submitted_claims", "estimated_fares"] as const;
export type CommissionBase = (typeof COMMISSION_BASES)[number];

/** Only bases whose math is proven by existing production code are payable.
 *  `paid_claims` = Medicaid trips whose billing record is `paid`, valued with
 *  computeClaimTotals (the same helper the legacy commission payout used). */
export const SUPPORTED_COMMISSION_BASES: CommissionBase[] = ["paid_claims"];

export const PER_TRIP_SOURCES = ["completed_trips"] as const;
export type PerTripSource = (typeof PER_TRIP_SOURCES)[number];

export const PLAN_LABEL: Record<PayPlan, string> = {
  hourly: "Hourly",
  commission: "Commission",
  per_trip: "Per trip",
  hybrid_hourly_commission: "Hourly + commission",
  hybrid_hourly_per_trip: "Hourly + per trip",
};

export const planUsesHours = (p: PayPlan) =>
  p === "hourly" || p === "hybrid_hourly_commission" || p === "hybrid_hourly_per_trip";
export const planUsesCommission = (p: PayPlan) =>
  p === "commission" || p === "hybrid_hourly_commission";
export const planUsesTrips = (p: PayPlan) => p === "per_trip" || p === "hybrid_hourly_per_trip";

export type PayPlanConfig = {
  plan: PayPlan | null;
  hourly_rate: number | null;
  commission_percentage: number | null;
  per_trip_amount: number | null;
  commission_base: CommissionBase | null;
  per_trip_source: PerTripSource | null;
};

export type ResolvedPayPlan = {
  plan: PayPlan;
  hourly_rate: number | null;
  commission_percentage: number | null;
  per_trip_amount: number | null;
  commission_base: CommissionBase;
  per_trip_source: PerTripSource;
  /** Which fields came from the driver override rather than the company. */
  overridden: string[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isSet = (v: unknown) => v !== null && v !== undefined && v !== "";

/**
 * FIELD-BY-FIELD MERGE OF THE TWO PER-DRIVER STORES.
 *
 * A driver's pay can be saved in two places: the modern `driver_pay_plans`
 * override and the legacy `driver_pay` row that the Driver Pay screen writes
 * (`payout_percentage` / `hourly_rate` / `pay_type`). Taking one row wholesale
 * silently dropped a percentage that was really saved — e.g. an override that
 * only set a plan shadowed the legacy 65%.
 *
 * The merge only ever FILLS IN missing fields; a value present on the modern
 * override always wins, and nothing here invents a rate.
 */
export function mergeDriverPayConfig(
  override: Partial<PayPlanConfig> | null | undefined,
  legacy: Partial<PayPlanConfig> | null | undefined,
): Partial<PayPlanConfig> | null {
  if (!override && !legacy) return null;
  const keys: (keyof PayPlanConfig)[] = [
    "plan",
    "hourly_rate",
    "commission_percentage",
    "per_trip_amount",
    "commission_base",
    "per_trip_source",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const o = override ? (override as Record<string, unknown>)[k] : null;
    const l = legacy ? (legacy as Record<string, unknown>)[k] : null;
    out[k] = isSet(o) ? o : isSet(l) ? l : null;
  }
  // A saved percentage with no explicit base still pays on state-paid claims,
  // which is what the legacy commission payout always did.
  if (isSet(out["commission_percentage"]) && !isSet(out["commission_base"])) {
    out["commission_base"] = "paid_claims";
  }
  return out as Partial<PayPlanConfig>;
}

/** Company defaults + per-driver override → the plan actually in force. */
export function resolvePayPlan(
  company: Partial<PayPlanConfig> & { default_plan?: PayPlan | null } = {},
  driver: Partial<PayPlanConfig> | null = null,
): ResolvedPayPlan {
  const overridden: string[] = [];
  const pick = <K extends keyof PayPlanConfig>(key: K, companyValue: unknown): unknown => {
    const d = driver ? (driver as Record<string, unknown>)[key] : null;
    if (d !== null && d !== undefined && d !== "") {
      overridden.push(String(key));
      return d;
    }
    return companyValue;
  };

  const plan = (pick("plan", company.default_plan ?? company.plan ?? "hourly") as PayPlan) ?? "hourly";
  return {
    plan: PAY_PLANS.includes(plan) ? plan : "hourly",
    hourly_rate: num(pick("hourly_rate", company.hourly_rate ?? null)),
    commission_percentage: num(pick("commission_percentage", company.commission_percentage ?? null)),
    per_trip_amount: num(pick("per_trip_amount", company.per_trip_amount ?? null)),
    commission_base: (pick("commission_base", company.commission_base ?? "unset") as CommissionBase) ?? "unset",
    per_trip_source:
      (pick("per_trip_source", company.per_trip_source ?? "completed_trips") as PerTripSource) ??
      "completed_trips",
    overridden,
  };
}

/** Configuration problems that must be fixed before a payout can be written. */
export function payPlanIssues(p: ResolvedPayPlan): string[] {
  const issues: string[] = [];
  if (planUsesHours(p.plan) && (p.hourly_rate == null || p.hourly_rate <= 0)) {
    issues.push("Set an hourly rate for this driver.");
  }
  if (planUsesCommission(p.plan)) {
    if (p.commission_percentage == null || p.commission_percentage <= 0) {
      issues.push("Set a commission percentage for this driver.");
    }
    if (!SUPPORTED_COMMISSION_BASES.includes(p.commission_base)) {
      issues.push(
        p.commission_base === "unset"
          ? "Choose the revenue this commission is based on (company pay settings)."
          : `Commission base "${p.commission_base}" is not supported yet — use state-paid claims.`,
      );
    }
  }
  if (planUsesTrips(p.plan) && (p.per_trip_amount == null || p.per_trip_amount <= 0)) {
    issues.push("Set a per-trip amount for this driver.");
  }
  return issues;
}

export type PayInputs = {
  hours: number;
  /** Revenue the commission percentage applies to (already filtered/valued). */
  revenue_base: number;
  claim_count: number;
  trip_count: number;
  fuel: number;
  bonus?: number;
  include_fuel?: boolean;
};

export type PayLine = {
  key: "hourly" | "commission" | "per_trip" | "fuel" | "adjustment";
  label: string;
  detail: string;
  amount: number;
};

export type PayBreakdown = {
  plan: PayPlan;
  hours: number;
  hourly_rate: number | null;
  hourly_pay: number;
  commission_percentage: number | null;
  commission_base: CommissionBase | null;
  revenue_base: number;
  claim_count: number;
  commission_amount: number;
  per_trip_amount: number | null;
  trip_count: number;
  trip_pay: number;
  fuel: number;
  bonus: number;
  earnings: number;
  total: number;
  lines: PayLine[];
};

const money = (n: number) => `$${round2(n).toFixed(2)}`;

/**
 * The one place a driver's pay is calculated. Deterministic, cent-exact, and
 * it explains every number it produced so the UI and the stored snapshot show
 * exactly the same reasoning.
 */
export function computePlanPay(plan: ResolvedPayPlan, input: PayInputs): PayBreakdown {
  const lines: PayLine[] = [];

  const hours = planUsesHours(plan.plan) ? round2(input.hours) : 0;
  const rate = planUsesHours(plan.plan) ? plan.hourly_rate : null;
  const hourlyPay = rate == null ? 0 : round2(hours * rate);
  if (planUsesHours(plan.plan)) {
    lines.push({
      key: "hourly",
      label: "Hourly",
      detail: `${hours.toFixed(2)}h × ${rate == null ? "no rate" : money(rate)}/hr`,
      amount: hourlyPay,
    });
  }

  const pct = planUsesCommission(plan.plan) ? plan.commission_percentage : null;
  const revenue = planUsesCommission(plan.plan) ? round2(input.revenue_base) : 0;
  const commission = pct == null ? 0 : round2((revenue * pct) / 100);
  if (planUsesCommission(plan.plan)) {
    lines.push({
      key: "commission",
      label: "Commission",
      detail: `${money(revenue)} of ${input.claim_count} paid claim${
        input.claim_count === 1 ? "" : "s"
      } × ${pct ?? 0}%`,
      amount: commission,
    });
  }

  const perTrip = planUsesTrips(plan.plan) ? plan.per_trip_amount : null;
  const tripCount = planUsesTrips(plan.plan) ? input.trip_count : 0;
  const tripPay = perTrip == null ? 0 : round2(tripCount * perTrip);
  if (planUsesTrips(plan.plan)) {
    lines.push({
      key: "per_trip",
      label: "Per trip",
      detail: `${tripCount} trip${tripCount === 1 ? "" : "s"} × ${
        perTrip == null ? "no amount" : money(perTrip)
      }`,
      amount: tripPay,
    });
  }

  const fuel = input.include_fuel === false ? 0 : round2(input.fuel);
  if (fuel !== 0) {
    lines.push({ key: "fuel", label: "Fuel reimbursement", detail: "unreimbursed receipts", amount: fuel });
  }
  const bonus = round2(input.bonus ?? 0);
  if (bonus !== 0) {
    lines.push({
      key: "adjustment",
      label: bonus > 0 ? "Bonus / adjustment" : "Deduction",
      detail: "manual adjustment",
      amount: bonus,
    });
  }

  const earnings = round2(hourlyPay + commission + tripPay);
  return {
    plan: plan.plan,
    hours,
    hourly_rate: rate,
    hourly_pay: hourlyPay,
    commission_percentage: pct,
    commission_base: planUsesCommission(plan.plan) ? plan.commission_base : null,
    revenue_base: revenue,
    claim_count: planUsesCommission(plan.plan) ? input.claim_count : 0,
    commission_amount: commission,
    per_trip_amount: perTrip,
    trip_count: tripCount,
    trip_pay: tripPay,
    fuel,
    bonus,
    earnings,
    total: round2(earnings + fuel + bonus),
    lines,
  };
}
