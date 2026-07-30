import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Every function in this module is ADMIN ONLY.
 *  Pay rates and earnings must never be reachable by dispatch or drivers
 *  other than through their own driver app stats. */
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

export const getDriverPay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row } = await context.supabase
      .from("driver_pay")
      .select("driver_id, hourly_rate, pay_type, updated_at")
      .eq("driver_id", data.driver_id)
      .maybeSingle();
    return {
      driver_id: data.driver_id,
      hourly_rate: row?.hourly_rate == null ? null : Number(row.hourly_rate),
      pay_type: row?.pay_type ?? "per_hour",
      updated_at: row?.updated_at ?? null,
    };
  });

export const setDriverHourlyRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id: string; hourly_rate: number | null }) => {
    if (input.hourly_rate != null && (input.hourly_rate < 0 || input.hourly_rate > 1000)) {
      throw new Error("Hourly rate must be between 0 and 1000");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("driver_pay")
      .upsert(
        { driver_id: data.driver_id, hourly_rate: data.hourly_rate },
        { onConflict: "driver_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, hourly_rate: data.hourly_rate };
  });

type EarningsInput = { driver_id: string; from: string; to: string };

/** Hours × hourly_rate, broken out by day, for the period, plus a running
 *  all-time total. Returns rate_set=false when no rate exists yet — that is
 *  an expected state, not an error. */
export const getDriverEarnings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EarningsInput) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const s = context.supabase;

    const [{ data: pay }, { data: shifts }, { data: allShifts }] = await Promise.all([
      s.from("driver_pay").select("hourly_rate").eq("driver_id", data.driver_id).maybeSingle(),
      s
        .from("driver_shifts")
        .select("id, clock_in_at, clock_out_at, gps_miles")
        .eq("driver_id", data.driver_id)
        .gte("clock_in_at", data.from)
        .lte("clock_in_at", data.to)
        .order("clock_in_at", { ascending: true }),
      s
        .from("driver_shifts")
        .select("clock_in_at, clock_out_at")
        .eq("driver_id", data.driver_id),
    ]);

    const rate = pay?.hourly_rate == null ? null : Number(pay.hourly_rate);
    const hoursOf = (r: { clock_in_at: string; clock_out_at: string | null }) => {
      const end = r.clock_out_at ? new Date(r.clock_out_at) : new Date();
      return Math.max(0, (end.getTime() - new Date(r.clock_in_at).getTime()) / 3_600_000);
    };

    const byDayMap = new Map<string, { hours: number; miles: number; shifts: number }>();
    let periodHours = 0;
    let periodMiles = 0;
    for (const r of shifts ?? []) {
      const h = hoursOf(r);
      periodHours += h;
      periodMiles += Number(r.gps_miles ?? 0);
      const day = new Date(r.clock_in_at).toISOString().slice(0, 10);
      const cur = byDayMap.get(day) ?? { hours: 0, miles: 0, shifts: 0 };
      cur.hours += h;
      cur.miles += Number(r.gps_miles ?? 0);
      cur.shifts += 1;
      byDayMap.set(day, cur);
    }
    const allTimeHours = (allShifts ?? []).reduce((sum, r) => sum + hoursOf(r), 0);

    const money = (h: number) => (rate == null ? null : Math.round(h * rate * 100) / 100);

    return {
      driver_id: data.driver_id,
      period: { from: data.from, to: data.to },
      rate_set: rate != null,
      hourly_rate: rate,
      by_day: [...byDayMap.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([day, v]) => ({
          day,
          hours: Math.round(v.hours * 100) / 100,
          miles: Math.round(v.miles * 100) / 100,
          shifts: v.shifts,
          earnings: money(v.hours),
        })),
      shifts: (shifts ?? []).map((r) => ({
        id: r.id,
        clock_in_at: r.clock_in_at,
        clock_out_at: r.clock_out_at,
        hours: Math.round(hoursOf(r) * 100) / 100,
        open: !r.clock_out_at,
      })),
      period_hours: Math.round(periodHours * 100) / 100,
      period_miles: Math.round(periodMiles * 100) / 100,
      period_earnings: money(periodHours),
      all_time_hours: Math.round(allTimeHours * 100) / 100,
      all_time_earnings: money(allTimeHours),
    };
  });

/** Payroll overview across all drivers for a period. Admin only. */
export const getEarningsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const s = context.supabase;
    const [{ data: drivers }, { data: pays }, { data: shifts }] = await Promise.all([
      s.from("drivers").select("id, user_id, status"),
      s.from("driver_pay").select("driver_id, hourly_rate"),
      s
        .from("driver_shifts")
        .select("driver_id, clock_in_at, clock_out_at, gps_miles")
        .gte("clock_in_at", data.from)
        .lte("clock_in_at", data.to),
    ]);

    const userIds = (drivers ?? []).map((d) => d.user_id).filter(Boolean);
    const { data: profiles } = userIds.length
      ? await s.from("profiles").select("id, first_name, last_name, email").in("id", userIds)
      : { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] };
    const nameOf = new Map((profiles ?? []).map((p) => [p.id, p]));
    const rateOf = new Map((pays ?? []).map((p) => [p.driver_id, p.hourly_rate == null ? null : Number(p.hourly_rate)]));

    const agg = new Map<string, { hours: number; miles: number }>();
    for (const r of shifts ?? []) {
      const end = r.clock_out_at ? new Date(r.clock_out_at) : new Date();
      const h = Math.max(0, (end.getTime() - new Date(r.clock_in_at).getTime()) / 3_600_000);
      const cur = agg.get(r.driver_id) ?? { hours: 0, miles: 0 };
      cur.hours += h;
      cur.miles += Number(r.gps_miles ?? 0);
      agg.set(r.driver_id, cur);
    }

    return {
      period: { from: data.from, to: data.to },
      rows: (drivers ?? []).map((d) => {
        const p = nameOf.get(d.user_id);
        const rate = rateOf.get(d.id) ?? null;
        const a = agg.get(d.id) ?? { hours: 0, miles: 0 };
        return {
          driver_id: d.id,
          name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (p?.email ?? "Driver"),
          email: p?.email ?? null,
          status: d.status,
          hourly_rate: rate,
          hours: Math.round(a.hours * 100) / 100,
          miles: Math.round(a.miles * 100) / 100,
          earnings: rate == null ? null : Math.round(a.hours * rate * 100) / 100,
        };
      }),
    };
  });
