import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computePay,
  payableHours,
  pendingFuel,
  payoutsInPeriod,
  periodsOverlap,
  round2,
  shiftHours,
  type PayoutLike,
} from "@/lib/payrollCalc";

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

export type PayrollRow = {
  driver_id: string;
  name: string;
  email: string | null;
  status: string;
  hourly_rate: number | null;
  hours: number;
  gross_earnings: number | null;
  fuel_pending: number;
  paid_in_period: number;
  outstanding: number | null;
  last_paid_at: string | null;
  open_shift: boolean;
  already_paid: boolean;
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

    const { data: drivers } = await scoped(s.from("drivers").select("id, user_id, status"), companyId);
    const driverIds = (drivers ?? []).map((d) => d.id);
    if (!driverIds.length) {
      return {
        period: { from, to },
        rows: [] as PayrollRow[],
        totals: { hours: 0, gross: 0, fuel: 0, paid: 0, outstanding: 0 },
      };
    }

    const [{ data: pays }, { data: shifts }, { data: overlapping }, { data: lastPaid }, { data: receipts }] =
      await Promise.all([
        s.from("driver_pay").select("driver_id, hourly_rate, pay_type").in("driver_id", driverIds),
        s
          .from("driver_shifts")
          .select("id, driver_id, clock_in_at, clock_out_at, payout_id")
          .in("driver_id", driverIds)
          .is("payout_id", null)
          .gte("clock_in_at", from)
          .lte("clock_in_at", to),
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
        s
          .from("gas_receipts")
          .select("id, driver_id, amount, submitted_at, reimbursed_at, payout_id")
          .in("driver_id", driverIds)
          .is("reimbursed_at", null)
          .is("payout_id", null)
          .gte("submitted_at", from)
          .lte("submitted_at", to),
      ]);

    const userIds = (drivers ?? []).map((d) => d.user_id).filter(Boolean);
    const { data: profiles } = userIds.length
      ? await s.from("profiles").select("id, first_name, last_name, email").in("id", userIds)
      : { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] };

    const profileOf = new Map((profiles ?? []).map((p) => [p.id, p]));
    const rateOf = new Map(
      (pays ?? []).map((p) => [p.driver_id, p.hourly_rate == null ? null : Number(p.hourly_rate)]),
    );
    const payTypeOf = new Map(
      (pays ?? []).map((p) => [p.driver_id, (p as { pay_type?: string }).pay_type ?? "per_hour"]),
    );

    const shiftsOf = new Map<string, typeof shifts>();
    for (const r of shifts ?? []) {
      const list = shiftsOf.get(r.driver_id) ?? [];
      list.push(r);
      shiftsOf.set(r.driver_id, list as typeof shifts);
    }
    const receiptsOf = new Map<string, typeof receipts>();
    for (const r of receipts ?? []) {
      const list = receiptsOf.get(r.driver_id) ?? [];
      list.push(r);
      receiptsOf.set(r.driver_id, list as typeof receipts);
    }

    const paidOf = new Map<string, number>();
    for (const p of payoutsInPeriod((overlapping ?? []) as PayoutLike[], from, to)) {
      paidOf.set(p.driver_id, round2((paidOf.get(p.driver_id) ?? 0) + Number(p.total_paid ?? 0)));
    }
    const lastPaidOf = new Map<string, string>();
    for (const p of lastPaid ?? []) if (!lastPaidOf.has(p.driver_id)) lastPaidOf.set(p.driver_id, p.paid_at);

    const rows: PayrollRow[] = (drivers ?? []).map((d) => {
      const p = profileOf.get(d.user_id);
      const rate = rateOf.get(d.id) ?? null;
      const { hours, openCount } = payableHours((shiftsOf.get(d.id) ?? []) as never, from, to);
      const fuel = pendingFuel((receiptsOf.get(d.id) ?? []) as never, from, to).amount;
      const paid = paidOf.get(d.id) ?? 0;
      const calc = computePay({ hours, hourly_rate: rate, fuel });
      return {
        driver_id: d.id,
        name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (p?.email ?? "Driver"),
        email: p?.email ?? null,
        status: String(d.status),
        hourly_rate: rate,
        hours,
        gross_earnings: calc.gross_earnings,
        fuel_pending: fuel,
        paid_in_period: paid,
        outstanding: calc.total == null ? null : round2(Math.max(0, calc.total - paid)),
        last_paid_at: lastPaidOf.get(d.id) ?? null,
        open_shift: openCount > 0,
        already_paid: paid > 0,
        pay_type: (payTypeOf.get(d.id) ?? "per_hour") as "per_hour" | "commission",
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

/**
 * Clear (pay out) a driver for a period.
 *
 * The server recomputes every number from the database — client totals are
 * never trusted. The exact shifts and fuel receipts paid are stamped with the
 * payout id, so the same work can never be paid twice, and the payout row
 * keeps its own snapshot so history survives later edits to shifts or rates.
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
      /** Set false to pay hours only and leave fuel receipts pending. */
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

    const { data: driver } = await scoped(
      s.from("drivers").select("id, company_id").eq("id", data.driver_id),
      companyId,
    ).maybeSingle();
    if (!driver) throw new Error("Driver not found in your company");

    // Duplicate / double-pay guard: any live payout overlapping this window.
    const { data: existing } = await s
      .from("driver_payouts")
      .select("id, period_start, period_end, paid_at, total_paid")
      .eq("driver_id", data.driver_id)
      .is("voided_at", null)
      .lte("period_start", to)
      .gte("period_end", from);
    const clash = (existing ?? []).find((p) => periodsOverlap(p.period_start, p.period_end, from, to));
    if (clash) {
      throw new Error(
        "This driver was already paid for an overlapping period. Void that payment first if it was a mistake.",
      );
    }

    const [{ data: pay }, { data: shifts }, { data: receipts }] = await Promise.all([
      s.from("driver_pay").select("hourly_rate").eq("driver_id", data.driver_id).maybeSingle(),
      s
        .from("driver_shifts")
        .select("id, driver_id, clock_in_at, clock_out_at, payout_id")
        .eq("driver_id", data.driver_id)
        .is("payout_id", null)
        .gte("clock_in_at", from)
        .lte("clock_in_at", to),
      s
        .from("gas_receipts")
        .select("id, driver_id, amount, submitted_at, reimbursed_at, payout_id")
        .eq("driver_id", data.driver_id)
        .is("reimbursed_at", null)
        .is("payout_id", null)
        .gte("submitted_at", from)
        .lte("submitted_at", to),
    ]);

    const rate = pay?.hourly_rate == null ? null : Number(pay.hourly_rate);
    const { hours, shiftIds } = payableHours((shifts ?? []) as never, from, to);
    const fuel = pendingFuel((receipts ?? []) as never, from, to);
    const includeFuel = data.include_fuel !== false;
    const calc = computePay({
      hours,
      hourly_rate: rate,
      fuel: fuel.amount,
      bonus: data.bonus_amount ?? 0,
      include_fuel: includeFuel,
    });

    if (calc.total == null) {
      throw new Error("Set an hourly rate for this driver before clearing pay.");
    }
    if (calc.total <= 0) {
      throw new Error("Nothing to pay for this period.");
    }

    const { data: row, error } = await s
      .from("driver_payouts")
      .insert({
        driver_id: data.driver_id,
        company_id: driver.company_id ?? companyId,
        period_start: from,
        period_end: to,
        hours: calc.hours,
        hourly_rate: calc.hourly_rate,
        gross_earnings: calc.gross_earnings ?? 0,
        fuel_reimbursed: calc.fuel,
        total_paid: calc.total,
        shift_count: shiftIds.length,
        bonus_amount: calc.bonus,
        bonus_note: data.bonus_note?.trim() || null,
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

    // Stamp the exact work this payment covers. If either stamp fails the
    // payout is voided again so nothing is silently paid without a link.
    try {
      if (shiftIds.length) {
        const { error: e } = await s
          .from("driver_shifts")
          .update({ payout_id: row.id, cleared_at: new Date().toISOString() })
          .in("id", shiftIds);
        if (e) throw new Error(e.message);
      }
      if (includeFuel && fuel.receiptIds.length) {
        const { error: e } = await s
          .from("gas_receipts")
          .update({
            payout_id: row.id,
            reimbursed_at: new Date().toISOString(),
            reimbursed_by: context.userId,
          })
          .in("id", fuel.receiptIds);
        if (e) throw new Error(e.message);
      }
    } catch (e) {
      await s
        .from("driver_payouts")
        .update({
          voided_at: new Date().toISOString(),
          voided_by: context.userId,
          void_reason: "Rolled back: could not link paid work",
        })
        .eq("id", row.id);
      throw e instanceof Error ? e : new Error("Could not finalize payment");
    }

    return { ...row, shifts_paid: shiftIds.length, receipts_paid: includeFuel ? fuel.receiptIds.length : 0 };
  });

/** What a driver would be paid right now for a period — used by the UI so the
 *  confirmation dialog shows exactly what the server will write. */
export const previewDriverPay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id: string; from: string; to: string }) => input)
  .handler(async ({ data, context }) => {
    const { companyId } = await assertPayrollAdmin(context.supabase, context.userId);
    const { from, to } = validPeriod(data.from, data.to);
    const s = context.supabase;

    const { data: driver } = await scoped(
      s.from("drivers").select("id").eq("id", data.driver_id),
      companyId,
    ).maybeSingle();
    if (!driver) throw new Error("Driver not found in your company");

    const [{ data: pay }, { data: shifts }, { data: receipts }, { data: existing }] = await Promise.all([
      s.from("driver_pay").select("hourly_rate").eq("driver_id", data.driver_id).maybeSingle(),
      s
        .from("driver_shifts")
        .select("id, driver_id, clock_in_at, clock_out_at, payout_id")
        .eq("driver_id", data.driver_id)
        .is("payout_id", null)
        .gte("clock_in_at", from)
        .lte("clock_in_at", to),
      s
        .from("gas_receipts")
        .select("id, driver_id, amount, submitted_at, reimbursed_at, payout_id")
        .eq("driver_id", data.driver_id)
        .is("reimbursed_at", null)
        .is("payout_id", null)
        .gte("submitted_at", from)
        .lte("submitted_at", to),
      s
        .from("driver_payouts")
        .select("id, period_start, period_end, paid_at, total_paid")
        .eq("driver_id", data.driver_id)
        .is("voided_at", null)
        .lte("period_start", to)
        .gte("period_end", from)
        .limit(5),
    ]);

    const rate = pay?.hourly_rate == null ? null : Number(pay.hourly_rate);
    const { hours, shiftIds, openCount } = payableHours((shifts ?? []) as never, from, to);
    const fuel = pendingFuel((receipts ?? []) as never, from, to);
    const calc = computePay({ hours, hourly_rate: rate, fuel: fuel.amount });

    return {
      period: { from, to },
      ...calc,
      shift_count: shiftIds.length,
      receipt_count: fuel.receiptIds.length,
      open_shifts: openCount,
      already_paid: existing ?? [],
    };
  });

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

    await Promise.all([
      s.from("driver_shifts").update({ payout_id: null, cleared_at: null }).eq("payout_id", data.id),
      s
        .from("gas_receipts")
        .update({ payout_id: null, reimbursed_at: null, reimbursed_by: null })
        .eq("payout_id", data.id),
    ]);

    return { ok: true };
  });

/** Back-compat alias for older callers. Voids rather than destroys. */
export const deletePayout = voidPayout;

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

    const { data: pay } = await s
      .from("driver_pay")
      .select("hourly_rate")
      .eq("driver_id", data.driver_id)
      .maybeSingle();
    const rate = pay?.hourly_rate == null ? 0 : Number(pay.hourly_rate);

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
