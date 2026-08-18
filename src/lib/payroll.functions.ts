import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** ADMIN ONLY — payout / "clear pay" system. Never expose to dispatch. */
async function assertAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin only");
}

const hoursBetween = (start: string, end: string | null) => {
  const e = end ? new Date(end) : new Date();
  return Math.max(0, (e.getTime() - new Date(start).getTime()) / 3_600_000);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  pay_type: "per_hour" | "commission";
};

/** Everything the payroll tab needs for one pay period. */
export const getPayrollPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const s = context.supabase;

    const [{ data: drivers }, { data: pays }, { data: shifts }, { data: payouts }, { data: receipts }] =
      await Promise.all([
        s.from("drivers").select("id, user_id, status"),
        s.from("driver_pay").select("driver_id, hourly_rate, pay_type"),
        s
          .from("driver_shifts")
          .select("driver_id, clock_in_at, clock_out_at")
          .gte("clock_in_at", data.from)
          .lte("clock_in_at", data.to),
        s
          .from("driver_payouts")
          .select("id, driver_id, total_paid, paid_at, period_start, period_end")
          .order("paid_at", { ascending: false }),
        s
          .from("gas_receipts")
          .select("id, driver_id, amount, submitted_at, reimbursed_at")
          .is("reimbursed_at", null)
          .gte("submitted_at", data.from)
          .lte("submitted_at", data.to),
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

    const hoursOf = new Map<string, number>();
    const openOf = new Set<string>();
    for (const r of shifts ?? []) {
      hoursOf.set(r.driver_id, (hoursOf.get(r.driver_id) ?? 0) + hoursBetween(r.clock_in_at, r.clock_out_at));
      if (!r.clock_out_at) openOf.add(r.driver_id);
    }

    const fuelOf = new Map<string, number>();
    for (const r of receipts ?? []) {
      fuelOf.set(r.driver_id, (fuelOf.get(r.driver_id) ?? 0) + Number(r.amount ?? 0));
    }

    const paidOf = new Map<string, number>();
    const lastPaidOf = new Map<string, string>();
    for (const p of payouts ?? []) {
      if (!lastPaidOf.has(p.driver_id)) lastPaidOf.set(p.driver_id, p.paid_at);
      // count payouts whose period overlaps the selected window
      if (new Date(p.period_start) <= new Date(data.to) && new Date(p.period_end) >= new Date(data.from)) {
        paidOf.set(p.driver_id, (paidOf.get(p.driver_id) ?? 0) + Number(p.total_paid ?? 0));
      }
    }

    const rows: PayrollRow[] = (drivers ?? []).map((d) => {
      const p = profileOf.get(d.user_id);
      const rate = rateOf.get(d.id) ?? null;
      const hours = round2(hoursOf.get(d.id) ?? 0);
      const gross = rate == null ? null : round2(hours * rate);
      const fuel = round2(fuelOf.get(d.id) ?? 0);
      const paid = round2(paidOf.get(d.id) ?? 0);
      return {
        driver_id: d.id,
        name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (p?.email ?? "Driver"),
        email: p?.email ?? null,
        status: String(d.status),
        hourly_rate: rate,
        hours,
        gross_earnings: gross,
        fuel_pending: fuel,
        paid_in_period: paid,
        outstanding: gross == null ? null : round2(Math.max(0, gross + fuel - paid)),
        last_paid_at: lastPaidOf.get(d.id) ?? null,
        open_shift: openOf.has(d.id),
        pay_type: (payTypeOf.get(d.id) ?? "per_hour") as "per_hour" | "commission",
      };
    });

    rows.sort((a, b) => (b.outstanding ?? -1) - (a.outstanding ?? -1));

    return {
      period: { from: data.from, to: data.to },
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

/** Clear (pay out) a driver for a period. Also marks that period's gas
 *  receipts reimbursed when fuel is included in the payment. */
export const clearDriverPay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      driver_id: string;
      from: string;
      to: string;
      hours: number;
      hourly_rate: number | null;
      gross_earnings: number;
      fuel_reimbursed: number;
      total_paid: number;
      method?: string;
      reference?: string | null;
      notes?: string | null;
    }) => {
      if (!(input.total_paid >= 0)) throw new Error("Enter a valid amount");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const s = context.supabase;

    const { data: row, error } = await s
      .from("driver_payouts")
      .insert({
        driver_id: data.driver_id,
        period_start: data.from,
        period_end: data.to,
        hours: data.hours,
        hourly_rate: data.hourly_rate,
        gross_earnings: data.gross_earnings,
        fuel_reimbursed: data.fuel_reimbursed,
        total_paid: data.total_paid,
        method: data.method ?? "manual",
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        paid_by: context.userId,
      })
      .select("id, paid_at, total_paid")
      .single();
    if (error) throw new Error(error.message);

    if (data.fuel_reimbursed > 0) {
      await s
        .from("gas_receipts")
        .update({ reimbursed_at: new Date().toISOString(), reimbursed_by: context.userId })
        .eq("driver_id", data.driver_id)
        .is("reimbursed_at", null)
        .gte("submitted_at", data.from)
        .lte("submitted_at", data.to);
    }

    return row;
  });

/** Payment history, newest first. Optionally for one driver. */
export const listPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const s = context.supabase;
    let q = s
      .from("driver_payouts")
      .select("*")
      .order("paid_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
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

/** Undo a payout entry (mistake correction). */
export const deletePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("driver_payouts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
    await assertAdmin(context.supabase, context.userId);
    const s = context.supabase;

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
        clock_in_at: start.toISOString(),
        clock_out_at: end.toISOString(),
        hourly_rate_snapshot: rate,
        earnings: round2(data.hours * rate),
      })
      .select("id, clock_in_at, clock_out_at, earnings")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
