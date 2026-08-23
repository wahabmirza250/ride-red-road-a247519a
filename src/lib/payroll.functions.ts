import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  payoutsInPeriod,
  periodsOverlap,
  round2,
  shiftHours,
  type PayoutLike,
} from "@/lib/payrollCalc";
import {
  computePlanPay,
  payPlanIssues,
  planUsesCommission,
  planUsesTrips,
  PLAN_LABEL,
  type PayBreakdown,
  type PayPlan,
} from "@/lib/payPlans";
import { collectWork, loadPayPlans, type DriverWork } from "@/lib/payrollSources.server";

/** ADMIN ONLY — payout / "clear pay" system. Never expose to dispatch.
 *  Returns the caller's company so every query can be scoped to it: the
 *  `drivers` admin policy is permissive, so tenant isolation has to be
 *  enforced in the query, not only by RLS. */
async function assertPayrollAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<{ companyId: string | null }> {
  const [{ data: role }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    supabase.from("profiles").select("company_id").eq("id", userId).maybeSingle(),
  ]);
  if (!role) throw new Error("Admin only");
  return { companyId: (profile?.company_id as string | null) ?? null };
}

const scoped = <T extends { eq: (c: string, v: string) => T }>(q: T, companyId: string | null) =>
  companyId ? q.eq("company_id", companyId) : q;

function validPeriod(from: string, to: string) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Invalid pay period");
  if (b <= a) throw new Error("Pay period end must come after the start");
  if (b - a > 366 * 86_400_000) throw new Error("Pay period cannot be longer than a year");
  return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
}

type Sb = import("@supabase/supabase-js").SupabaseClient;

/** Drivers of the caller's company with display names, in one query pair. */
async function loadDrivers(s: Sb, companyId: string | null, driverId?: string) {
  let q: any = s.from("drivers").select("id, user_id, status");
  if (companyId) q = q.eq("company_id", companyId);
  if (driverId) q = q.eq("id", driverId);
  const { data: drivers } = await q;
  const rows = (drivers ?? []) as { id: string; user_id: string | null; status: string }[];
  const userIds = rows.map((d) => d.user_id).filter(Boolean) as string[];
  const { data: profiles } = userIds.length
    ? await s.from("profiles").select("id, first_name, last_name, email").in("id", userIds)
    : { data: [] as any[] };
  const pOf = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  return rows.map((d) => {
    const p = d.user_id ? pOf.get(d.user_id) : null;
    return {
      ...d,
      name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (p?.email ?? "Driver"),
      email: (p?.email as string | null) ?? null,
    };
  });
}

export type PayrollRow = {
  driver_id: string;
  name: string;
  email: string | null;
  status: string;
  plan: PayPlan;
  plan_label: string;
  hourly_rate: number | null;
  commission_percentage: number | null;
  per_trip_amount: number | null;
  hours: number;
  claim_count: number;
  revenue_base: number;
  trip_count: number;
  gross_earnings: number | null;
  fuel_pending: number;
  paid_in_period: number;
  outstanding: number | null;
  last_paid_at: string | null;
  open_shift: boolean;
  already_paid: boolean;
  issues: string[];
  /** Legacy field kept for older UI code. */
  pay_type: "per_hour" | "commission";
};

/** Everything the payroll tab needs for one pay period — one round of
 *  queries, all scoped to the caller's company, all filtering already done
 *  in the database (no client-side scanning of unrelated rows). */
export const getPayrollPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const { from, to } = validPeriod(data.from, data.to);
    const s = context.supabase;

    const drivers = await loadDrivers(s, companyId);
    const driverIds = drivers.map((d) => d.id);
    if (!driverIds.length) {
      return {
        period: { from, to },
        rows: [] as PayrollRow[],
        totals: { hours: 0, gross: 0, fuel: 0, paid: 0, outstanding: 0 },
      };
    }

    const plans = await loadPayPlans(s, companyId, driverIds);
    const [work, { data: overlapping }, { data: lastPaid }] = await Promise.all([
      collectWork(s, { companyId, drivers, plans, from, to }),
      s
        .from("driver_payouts")
        .select("driver_id, total_paid, paid_at, period_start, period_end, voided_at")
        .in("driver_id", driverIds)
        .is("voided_at", null)
        .lte("period_start", to)
        .gte("period_end", from),
      s
        .from("driver_payouts")
        .select("driver_id, paid_at")
        .in("driver_id", driverIds)
        .is("voided_at", null)
        .order("paid_at", { ascending: false })
        .limit(500),
    ]);

    const paidOf = new Map<string, number>();
    for (const p of payoutsInPeriod((overlapping ?? []) as PayoutLike[], from, to)) {
      paidOf.set(p.driver_id, round2((paidOf.get(p.driver_id) ?? 0) + Number(p.total_paid ?? 0)));
    }
    const lastPaidOf = new Map<string, string>();
    for (const p of lastPaid ?? []) if (!lastPaidOf.has(p.driver_id)) lastPaidOf.set(p.driver_id, p.paid_at);

    const rows: PayrollRow[] = drivers.map((d) => {
      const plan = plans.get(d.id)!;
      const w = work.get(d.id)!;
      const issues = payPlanIssues(plan);
      const calc = computePlanPay(plan, {
        hours: w.hours,
        revenue_base: w.revenue_base,
        claim_count: w.claims.length,
        trip_count: w.trip_count,
        fuel: w.fuel,
      });
      const paid = paidOf.get(d.id) ?? 0;
      const payable = issues.length ? null : calc.total;
      return {
        driver_id: d.id,
        name: d.name,
        email: d.email,
        status: String(d.status),
        plan: plan.plan,
        plan_label: PLAN_LABEL[plan.plan],
        hourly_rate: plan.hourly_rate,
        commission_percentage: plan.commission_percentage,
        per_trip_amount: plan.per_trip_amount,
        hours: calc.hours,
        claim_count: calc.claim_count,
        revenue_base: calc.revenue_base,
        trip_count: calc.trip_count,
        gross_earnings: issues.length ? null : calc.earnings,
        fuel_pending: w.fuel,
        paid_in_period: paid,
        outstanding: payable == null ? null : round2(Math.max(0, payable - paid)),
        last_paid_at: lastPaidOf.get(d.id) ?? null,
        open_shift: w.open_shifts > 0,
        already_paid: paid > 0,
        issues,
        pay_type: planUsesCommission(plan.plan) ? "commission" : "per_hour",
      };
    });

    rows.sort((a, b) => (b.outstanding ?? -1) - (a.outstanding ?? -1));

    return {
      period: { from, to },
      rows,
      totals: {
        hours: round2(rows.reduce((n, r) => n + r.hours, 0)),
        gross: round2(rows.reduce((n, r) => n + (r.gross_earnings ?? 0), 0)),
        fuel: round2(rows.reduce((n, r) => n + r.fuel_pending, 0)),
        paid: round2(rows.reduce((n, r) => n + r.paid_in_period, 0)),
        outstanding: round2(rows.reduce((n, r) => n + (r.outstanding ?? 0), 0)),
      },
    };
  });

/** Shared preview: resolves the plan, gathers the work, prices it. */
async function buildPreview(
  s: Sb,
  companyId: string | null,
  driverId: string,
  from: string,
  to: string,
  extra: { bonus?: number; include_fuel?: boolean } = {},
) {
  const drivers = await loadDrivers(s, companyId, driverId);
  const driver = drivers[0];
  if (!driver) throw new Error("Driver not found in your company");

  const plans = await loadPayPlans(s, companyId, [driverId]);
  const plan = plans.get(driverId)!;
  const work = (await collectWork(s, { companyId, drivers, plans, from, to })).get(driverId) as DriverWork;

  const calc = computePlanPay(plan, {
    hours: work.hours,
    revenue_base: work.revenue_base,
    claim_count: work.claims.length,
    trip_count: work.trip_count,
    fuel: work.fuel,
    bonus: extra.bonus ?? 0,
    include_fuel: extra.include_fuel,
  });
  return { driver, plan, work, calc, issues: payPlanIssues(plan) };
}

/** What a driver would be paid right now for a period — used by the UI so the
 *  confirmation dialog shows exactly what the server will write. */
export const previewDriverPay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { driver_id: string; from: string; to: string; bonus_amount?: number; include_fuel?: boolean }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const { from, to } = validPeriod(data.from, data.to);
    const s = context.supabase;

    const { driver, plan, work, calc, issues } = await buildPreview(s, companyId, data.driver_id, from, to, {
      bonus: data.bonus_amount ?? 0,
      include_fuel: data.include_fuel,
    });

    const { data: existing } = await s
      .from("driver_payouts")
      .select("id, period_start, period_end, paid_at, total_paid")
      .eq("driver_id", data.driver_id)
      .is("voided_at", null)
      .lte("period_start", to)
      .gte("period_end", from)
      .limit(5);

    return {
      period: { from, to },
      driver_name: driver.name,
      plan: plan.plan,
      plan_label: PLAN_LABEL[plan.plan],
      issues,
      breakdown: calc satisfies PayBreakdown,
      // Flat fields kept so existing UI bindings keep working.
      hours: calc.hours,
      hourly_rate: calc.hourly_rate,
      gross_earnings: issues.length ? null : calc.earnings,
      fuel: calc.fuel,
      bonus: calc.bonus,
      total: issues.length ? null : calc.total,
      shift_count: work.shift_ids.length,
      receipt_count: work.fuel_receipt_ids.length,
      claim_count: work.claims.length,
      trip_count: work.trip_count,
      revenue_base: work.revenue_base,
      claims: work.claims,
      open_shifts: work.open_shifts,
      already_paid: existing ?? [],
    };
  });

/**
 * Clear (pay out) a driver for a period.
 *
 * The server recomputes every number from the database — client totals are
 * never trusted. Every shift, fuel receipt, trip and claim included is written
 * as a payout line, and the unique index on those lines makes paying the same
 * work twice impossible, whatever the pay plan.
 */
export const clearDriverPay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      driver_id: string;
      from: string;
      to: string;
      /** Optional bonus / adjustment added on top of the computed pay. */
      bonus_amount?: number;
      bonus_note?: string | null;
      /** Set false to pay earnings only and leave fuel receipts pending. */
      include_fuel?: boolean;
      method?: string;
      reference?: string | null;
      notes?: string | null;
    }) => {
      if (!input.driver_id) throw new Error("Pick a driver");
      const bonus = input.bonus_amount ?? 0;
      if (!Number.isFinite(bonus)) throw new Error("Enter a valid adjustment amount");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const { from, to } = validPeriod(data.from, data.to);
    const s = context.supabase;
    const includeFuel = data.include_fuel !== false;

    const { driver, plan, work, calc, issues } = await buildPreview(s, companyId, data.driver_id, from, to, {
      bonus: data.bonus_amount ?? 0,
      include_fuel: includeFuel,
    });
    if (issues.length) throw new Error(issues.join(" "));

    // Duplicate / double-pay guard: any live payout overlapping this window.
    const { data: existing } = await s
      .from("driver_payouts")
      .select("id, period_start, period_end, paid_at, total_paid")
      .eq("driver_id", data.driver_id)
      .is("voided_at", null)
      .lte("period_start", to)
      .gte("period_end", from);
    if ((existing ?? []).some((p) => periodsOverlap(p.period_start, p.period_end, from, to))) {
      throw new Error(
        "This driver was already paid for an overlapping period. Void that payment first if it was a mistake.",
      );
    }

    if (calc.total <= 0) throw new Error("Nothing to pay for this period.");

    const { data: driverRow } = await s
      .from("drivers")
      .select("company_id")
      .eq("id", data.driver_id)
      .maybeSingle();

    const { data: row, error } = await s
      .from("driver_payouts")
      .insert({
        driver_id: data.driver_id,
        company_id: driverRow?.company_id ?? companyId,
        period_start: from,
        period_end: to,
        plan: plan.plan,
        hours: calc.hours,
        hourly_rate: calc.hourly_rate,
        hourly_pay: calc.hourly_pay,
        commission_percentage: calc.commission_percentage,
        commission_base: calc.commission_base,
        revenue_base: calc.revenue_base,
        commission_amount: calc.commission_amount,
        claim_count: calc.claim_count,
        per_trip_amount: calc.per_trip_amount,
        trip_count: calc.trip_count,
        trip_pay: calc.trip_pay,
        gross_earnings: calc.earnings,
        fuel_reimbursed: calc.fuel,
        total_paid: calc.total,
        shift_count: work.shift_ids.length,
        bonus_amount: calc.bonus,
        bonus_note: data.bonus_note?.trim() || null,
        breakdown: calc,
        method: data.method ?? "manual",
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        paid_by: context.userId,
      })
      .select("id, paid_at, total_paid, hours, gross_earnings, fuel_reimbursed, bonus_amount")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("This driver was already paid for that exact period.");
      throw new Error(error.message);
    }

    // Stamp the exact work this payment covers. If any stamp fails the payout
    // is voided again so nothing is silently paid without a link.
    const nowIso = new Date().toISOString();
    const company = driverRow?.company_id ?? companyId;
    const lines = [
      ...work.shift_ids.map((id) => ({ kind: "shift", ref_id: id, amount: 0, quantity: null as number | null })),
      ...(planUsesTrips(plan.plan)
        ? work.trip_ids.map((id) => ({
            kind: "trip",
            ref_id: id,
            amount: plan.per_trip_amount ?? 0,
            quantity: 1 as number | null,
          }))
        : []),
      ...(planUsesCommission(plan.plan)
        ? work.claims.map((c) => ({
            kind: "claim",
            ref_id: c.trip_id,
            amount: round2((c.amount * (plan.commission_percentage ?? 0)) / 100),
            quantity: null as number | null,
          }))
        : []),
      ...(includeFuel
        ? work.fuel_receipt_ids.map((id) => ({
            kind: "fuel",
            ref_id: id,
            amount: 0,
            quantity: null as number | null,
          }))
        : []),
    ].map((l) => ({ ...l, payout_id: row.id, driver_id: data.driver_id, company_id: company, occurred_at: nowIso }));

    try {
      if (lines.length) {
        const { error: e } = await s.from("driver_payout_items").insert(lines);
        if (e) {
          throw new Error(
            e.code === "23505"
              ? "Some of this work was just paid by someone else. Reload and try again."
              : e.message,
          );
        }
      }
      if (work.shift_ids.length) {
        const { error: e } = await s
          .from("driver_shifts")
          .update({ payout_id: row.id, cleared_at: nowIso })
          .in("id", work.shift_ids);
        if (e) throw new Error(e.message);
      }
      if (planUsesTrips(plan.plan) && work.trip_ids.length) {
        const { error: e } = await s.from("trips").update({ payout_id: row.id }).in("id", work.trip_ids);
        if (e) throw new Error(e.message);
      }
      if (includeFuel && work.fuel_receipt_ids.length) {
        const { error: e } = await s
          .from("gas_receipts")
          .update({ payout_id: row.id, reimbursed_at: nowIso, reimbursed_by: context.userId })
          .in("id", work.fuel_receipt_ids);
        if (e) throw new Error(e.message);
      }
    } catch (e) {
      await releasePayout(s, row.id);
      await s
        .from("driver_payouts")
        .update({
          voided_at: nowIso,
          voided_by: context.userId,
          void_reason: "Rolled back: could not link paid work",
        })
        .eq("id", row.id);
      throw e instanceof Error ? e : new Error("Could not finalize payment");
    }

    return {
      ...row,
      plan: plan.plan,
      shifts_paid: work.shift_ids.length,
      trips_paid: planUsesTrips(plan.plan) ? work.trip_ids.length : 0,
      claims_paid: planUsesCommission(plan.plan) ? work.claims.length : 0,
      receipts_paid: includeFuel ? work.fuel_receipt_ids.length : 0,
    };
  });

/** Release every piece of work a payout locked, so it can be paid correctly. */
async function releasePayout(s: Sb, payoutId: string) {
  await Promise.all([
    s.from("driver_shifts").update({ payout_id: null, cleared_at: null }).eq("payout_id", payoutId),
    s.from("trips").update({ payout_id: null }).eq("payout_id", payoutId),
    s
      .from("gas_receipts")
      .update({ payout_id: null, reimbursed_at: null, reimbursed_by: null })
      .eq("payout_id", payoutId),
    s.from("driver_payout_items").delete().eq("payout_id", payoutId),
  ]);
}

/** Payment history, newest first. Optionally for one driver. */
export const listPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id?: string; limit?: number; include_voided?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const s = context.supabase;

    let q = scoped(s.from("driver_payouts").select("*"), companyId)
      .order("paid_at", { ascending: false })
      .limit(Math.min(Math.max(data.limit ?? 100, 1), 500));
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    if (!data.include_voided) q = q.is("voided_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = [...new Set((rows ?? []).map((r) => r.driver_id))];
    const { data: drivers } = ids.length
      ? await s.from("drivers").select("id, user_id").in("id", ids)
      : { data: [] as { id: string; user_id: string }[] };
    const userIds = (drivers ?? []).map((d) => d.user_id);
    const { data: profiles } = userIds.length
      ? await s.from("profiles").select("id, first_name, last_name, email").in("id", userIds)
      : { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] };
    const pOf = new Map((profiles ?? []).map((p) => [p.id, p]));
    const nameOf = new Map(
      (drivers ?? []).map((d) => {
        const p = pOf.get(d.user_id);
        return [d.id, `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (p?.email ?? "Driver")];
      }),
    );

    return (rows ?? []).map((r) => ({ ...r, driver_name: nameOf.get(r.driver_id) ?? "Driver" }));
  });

/** Void a payout (mistake correction). The row is kept for the audit trail and
 *  the work it covered is released so it can be paid correctly. */
export const voidPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string | null }) => {
    if (!input.id) throw new Error("Missing payment");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const s = context.supabase;

    const { data: payout } = await scoped(
      s.from("driver_payouts").select("id, voided_at").eq("id", data.id),
      companyId,
    ).maybeSingle();
    if (!payout) throw new Error("Payment not found");
    if (payout.voided_at) return { ok: true, already: true };

    const { error } = await s
      .from("driver_payouts")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: context.userId,
        void_reason: data.reason?.trim() || "Voided by admin",
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await releasePayout(s, data.id);
    return { ok: true };
  });

/**
 * Manual time / overtime entry. Hourly drivers sometimes work time the app
 * never saw (paper timesheet, forgotten clock-in, approved overtime). This
 * writes a normal closed `driver_shifts` row so the hours flow through every
 * existing payroll calculation unchanged.
 */
export const addManualHours = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { driver_id: string; date: string; hours: number; note?: string | null }) => {
      if (!input.driver_id) throw new Error("Pick a driver");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pick a valid date");
      if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24) {
        throw new Error("Hours must be between 0 and 24");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const s = context.supabase;

    const { data: driver } = await scoped(
      s.from("drivers").select("id, company_id").eq("id", data.driver_id),
      companyId,
    ).maybeSingle();
    if (!driver) throw new Error("Driver not found in your company");

    const plans = await loadPayPlans(s, companyId, [data.driver_id]);
    const rate = plans.get(data.driver_id)?.hourly_rate ?? 0;

    // Anchor the entry at 09:00 on the chosen day so it lands inside any
    // pay period that contains that date.
    const start = new Date(`${data.date}T09:00:00`);
    const end = new Date(start.getTime() + data.hours * 3_600_000);

    const { data: row, error } = await s
      .from("driver_shifts")
      .insert({
        driver_id: data.driver_id,
        company_id: driver.company_id ?? companyId,
        clock_in_at: start.toISOString(),
        clock_out_at: end.toISOString(),
        hourly_rate_snapshot: rate,
        earnings: round2(shiftHours(start.toISOString(), end.toISOString()) * rate),
      })
      .select("id, clock_in_at, clock_out_at, earnings")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
