/**
 * Where payroll gets its raw work from.
 *
 * One module reads every kind of paid work (hours, state-paid claims,
 * completed trips, fuel) so the calculation layer stays pure and every pay
 * plan sees the same, already de-duplicated data.
 *
 * Double-pay safety: a piece of work is only "payable" when nothing has
 * claimed it yet — a shift/receipt with no payout_id, a trip with no payout_id
 * and no payout line, a claim with no payout line in either the new
 * `driver_payout_items` table or the legacy `driver_claim_payout_items` one.
 */

import {
  payableHours,
  pendingFuel,
  round2,
  type ReceiptLike,
  type ShiftLike,
} from "@/lib/payrollCalc";
import {
  planUsesCommission,
  planUsesHours,
  planUsesTrips,
  resolvePayPlan,
  type PayPlan,
  type ResolvedPayPlan,
} from "@/lib/payPlans";

type Sb = import("@supabase/supabase-js").SupabaseClient;

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

export type CompanyPaySettings = {
  company_id: string;
  default_plan: PayPlan;
  hourly_rate: number | null;
  commission_percentage: number | null;
  per_trip_amount: number | null;
  commission_base: import("@/lib/payPlans").CommissionBase;
  per_trip_source: import("@/lib/payPlans").PerTripSource;
};

export async function loadCompanyPaySettings(
  s: Sb,
  companyId: string | null,
): Promise<CompanyPaySettings | null> {
  if (!companyId) return null;
  const { data } = await s
    .from("company_pay_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as CompanyPaySettings | null) ?? null;
}

/** Effective plan for each driver: company defaults + per-driver overrides.
 *  Falls back to the legacy `driver_pay` row so drivers configured before
 *  pay plans existed keep being paid exactly as they were. */
export async function loadPayPlans(
  s: Sb,
  companyId: string | null,
  driverIds: string[],
): Promise<Map<string, ResolvedPayPlan>> {
  const out = new Map<string, ResolvedPayPlan>();
  if (!driverIds.length) return out;

  const [company, { data: plans }, { data: legacy }] = await Promise.all([
    loadCompanyPaySettings(s, companyId),
    s.from("driver_pay_plans").select("*").in("driver_id", driverIds),
    s.from("driver_pay").select("driver_id, hourly_rate, payout_percentage, pay_type").in("driver_id", driverIds),
  ]);

  const planOf = new Map((plans ?? []).map((p: any) => [p.driver_id as string, p]));
  const legacyOf = new Map((legacy ?? []).map((p: any) => [p.driver_id as string, p]));

  for (const id of driverIds) {
    const override = planOf.get(id) ?? null;
    const old = legacyOf.get(id);
    const fallback = old
      ? {
          plan: (old.pay_type === "commission" ? "commission" : "hourly") as PayPlan,
          hourly_rate: old.hourly_rate ?? null,
          commission_percentage: old.payout_percentage ?? null,
          per_trip_amount: null,
          commission_base: old.pay_type === "commission" ? "paid_claims" : null,
          per_trip_source: null,
        }
      : null;
    out.set(id, resolvePayPlan(company ?? {}, override ?? fallback));
  }
  return out;
}

export type ClaimWork = {
  trip_id: string;
  trip_date: string | null;
  member_name: string | null;
  amount: number;
};

export type DriverWork = {
  hours: number;
  shift_ids: string[];
  open_shifts: number;
  fuel: number;
  fuel_receipt_ids: string[];
  revenue_base: number;
  claims: ClaimWork[];
  trip_count: number;
  trip_ids: string[];
};

const EMPTY: DriverWork = {
  hours: 0,
  shift_ids: [],
  open_shifts: 0,
  fuel: 0,
  fuel_receipt_ids: [],
  revenue_base: 0,
  claims: [],
  trip_count: 0,
  trip_ids: [],
};

/**
 * All payable work for a set of drivers in one period, in a fixed number of
 * queries regardless of how many drivers a company has.
 */
export async function collectWork(
  s: Sb,
  opts: {
    companyId: string | null;
    drivers: { id: string; user_id: string | null; name: string }[];
    plans: Map<string, ResolvedPayPlan>;
    from: string;
    to: string;
  },
): Promise<Map<string, DriverWork>> {
  const { drivers, plans, from, to } = opts;
  const out = new Map<string, DriverWork>(drivers.map((d) => [d.id, { ...EMPTY, shift_ids: [], fuel_receipt_ids: [], claims: [], trip_ids: [] }]));
  if (!drivers.length) return out;

  const ids = drivers.map((d) => d.id);
  const needHours = drivers.filter((d) => planUsesHours(plans.get(d.id)?.plan ?? "hourly")).map((d) => d.id);
  const needClaims = drivers.filter((d) => planUsesCommission(plans.get(d.id)?.plan ?? "hourly"));
  const needTrips = drivers.filter((d) => planUsesTrips(plans.get(d.id)?.plan ?? "hourly")).map((d) => d.id);

  const [{ data: shifts }, { data: receipts }] = await Promise.all([
    needHours.length
      ? s
          .from("driver_shifts")
          .select("id, driver_id, clock_in_at, clock_out_at, payout_id")
          .in("driver_id", needHours)
          .is("payout_id", null)
          .gte("clock_in_at", from)
          .lte("clock_in_at", to)
      : Promise.resolve({ data: [] as any[] }),
    s
      .from("gas_receipts")
      .select("id, driver_id, amount, submitted_at, reimbursed_at, payout_id")
      .in("driver_id", ids)
      .is("reimbursed_at", null)
      .is("payout_id", null)
      .gte("submitted_at", from)
      .lte("submitted_at", to),
  ]);

  const byDriver = <T extends { driver_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.driver_id) ?? [];
      list.push(r);
      m.set(r.driver_id, list);
    }
    return m;
  };
  const shiftsOf = byDriver((shifts ?? []) as ShiftLike[]);
  const receiptsOf = byDriver((receipts ?? []) as ReceiptLike[]);

  for (const d of drivers) {
    const w = out.get(d.id)!;
    const h = payableHours(shiftsOf.get(d.id) ?? [], from, to);
    w.hours = h.hours;
    w.shift_ids = h.shiftIds;
    w.open_shifts = h.openCount;
    const f = pendingFuel(receiptsOf.get(d.id) ?? [], from, to);
    w.fuel = f.amount;
    w.fuel_receipt_ids = f.receiptIds;
  }

  // ---- Per-trip pay: completed dispatch trips not yet attached to a payout.
  if (needTrips.length) {
    const { data: trips } = await s
      .from("trips")
      .select("id, driver_id, status, scheduled_pickup_time, payout_id")
      .in("driver_id", needTrips)
      .eq("status", "completed")
      .is("payout_id", null)
      .gte("scheduled_pickup_time", from)
      .lte("scheduled_pickup_time", to)
      .limit(5000);
    const tripIds = (trips ?? []).map((t: any) => t.id as string);
    const lockedTrips = await lockedRefs(s, "trip", tripIds);
    for (const t of (trips ?? []) as any[]) {
      if (lockedTrips.has(t.id)) continue;
      const w = out.get(t.driver_id);
      if (!w) continue;
      w.trip_ids.push(t.id);
      w.trip_count += 1;
    }
  }

  // ---- Commission: claims the STATE paid, valued by the billing engine.
  if (needClaims.length) {
    const { data: mTrips } = await s
      .from("medicaid_trips")
      .select(
        "id, company_id, vehicle_type, odometer_start, odometer_end, pickup_at, driver_id, paper_driver_name, robot_captured_claim, riders(full_name), medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
      )
      .gte("pickup_at", from)
      .lte("pickup_at", to)
      .limit(5000);

    const rows = (mTrips ?? []) as any[];
    const ownerOf = new Map<string, string>(); // medicaid trip id -> driver_id
    for (const t of rows) {
      const match = needClaims.find(
        (d) =>
          (d.user_id && t.driver_id === d.user_id) ||
          (!!d.name && norm(t.paper_driver_name) === norm(d.name)),
      );
      if (match) ownerOf.set(t.id, match.id);
    }
    const claimTripIds = [...ownerOf.keys()];
    if (claimTripIds.length) {
      const [{ data: records }, lockedNew, { data: legacyItems }] = await Promise.all([
        s.from("billing_records").select("trip_id, status").in("trip_id", claimTripIds),
        lockedRefs(s, "claim", claimTripIds),
        s.from("driver_claim_payout_items").select("trip_id").in("trip_id", claimTripIds),
      ]);
      const paid = new Set(
        ((records ?? []) as any[]).filter((r) => r.status === "paid").map((r) => r.trip_id),
      );
      const legacyLocked = new Set(((legacyItems ?? []) as any[]).map((i) => i.trip_id));
      const payableRows = rows.filter(
        (t) => paid.has(t.id) && !lockedNew.has(t.id) && !legacyLocked.has(t.id) && ownerOf.has(t.id),
      );
      if (payableRows.length) {
        const { computeClaimTotals } = await import("@/lib/claimAmount.server");
        const totals = await computeClaimTotals(s, payableRows);
        for (const t of payableRows) {
          const w = out.get(ownerOf.get(t.id)!);
          if (!w) continue;
          const amount = round2(totals.get(t.id)?.amount ?? 0);
          if (amount <= 0) continue;
          w.claims.push({
            trip_id: t.id,
            trip_date: t.pickup_at ?? null,
            member_name: t.riders?.full_name ?? null,
            amount,
          });
          w.revenue_base = round2(w.revenue_base + amount);
        }
      }
    }
  }

  return out;
}

/** Refs already attached to a live payout line. */
export async function lockedRefs(s: Sb, kind: string, refIds: string[]): Promise<Set<string>> {
  if (!refIds.length) return new Set();
  const found = new Set<string>();
  for (let i = 0; i < refIds.length; i += 500) {
    const { data } = await s
      .from("driver_payout_items")
      .select("ref_id")
      .eq("kind", kind)
      .in("ref_id", refIds.slice(i, i + 500));
    for (const r of (data ?? []) as any[]) found.add(r.ref_id);
  }
  return found;
}
