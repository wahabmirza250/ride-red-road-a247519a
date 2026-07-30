import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Driver identity + their pay config. Pay lives in the admin-only
 *  `driver_pay` table; hourly_rate may be null until an admin sets it. */
async function getDriver(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Driver profile not found");
  const { data: pay } = await supabaseAdmin
    .from("driver_pay")
    .select("hourly_rate, pay_type")
    .eq("driver_id", data.id)
    .maybeSingle();
  return {
    id: data.id as string,
    hourly_rate: pay?.hourly_rate == null ? null : Number(pay.hourly_rate),
    pay_type: pay?.pay_type ?? "per_hour",
  };
}

/** Start a shift. Idempotent — returns the currently open shift if one exists. */
export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { start_odometer?: number | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);

    const { data: open } = await supabaseAdmin
      .from("driver_shifts")
      .select("*")
      .eq("driver_id", driver.id)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open) return open;

    const { data: row, error } = await supabaseAdmin
      .from("driver_shifts")
      .insert({
        driver_id: driver.id,
        start_odometer: data.start_odometer ?? null,
        hourly_rate_snapshot: driver.hourly_rate ?? 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { end_odometer?: number | null; gps_miles?: number | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);
    const { data: open } = await supabaseAdmin
      .from("driver_shifts")
      .select("*")
      .eq("driver_id", driver.id)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!open) return null;

    const now = new Date();
    const hours = Math.max(0, (now.getTime() - new Date(open.clock_in_at).getTime()) / 3600000);
    const miles = data.gps_miles ?? open.gps_miles ?? 0;
    const rate = open.hourly_rate_snapshot ?? driver.hourly_rate ?? 0;
    const earnings = Math.round(hours * Number(rate) * 100) / 100;

    const { data: closed, error } = await supabaseAdmin
      .from("driver_shifts")
      .update({
        clock_out_at: now.toISOString(),
        end_odometer: data.end_odometer ?? open.end_odometer ?? null,
        gps_miles: miles,
        earnings,
      })
      .eq("id", open.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return closed;
  });

export const getCurrentShift = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);
    const { data } = await supabaseAdmin
      .from("driver_shifts")
      .select("*")
      .eq("driver_id", driver.id)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { shift: data, hourly_rate: driver.hourly_rate, pay_type: driver.pay_type };
  });

/** Aggregate for dashboard: today + all-time hours, miles, earnings. */
export const getShiftStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data: rows } = await supabaseAdmin
      .from("driver_shifts")
      .select("clock_in_at, clock_out_at, gps_miles, earnings, hourly_rate_snapshot")
      .eq("driver_id", driver.id)
      .gte("clock_in_at", startOfDay.toISOString());

    let hours = 0;
    let miles = 0;
    let earnings = 0;
    let openSince: string | null = null;
    for (const r of rows ?? []) {
      const end = r.clock_out_at ? new Date(r.clock_out_at) : new Date();
      const h = Math.max(0, (end.getTime() - new Date(r.clock_in_at).getTime()) / 3600000);
      hours += h;
      miles += Number(r.gps_miles ?? 0);
      earnings += r.clock_out_at
        ? Number(r.earnings ?? 0)
        : Math.round(h * Number(r.hourly_rate_snapshot ?? 0) * 100) / 100;
      if (!r.clock_out_at) openSince = r.clock_in_at;
    }
    return {
      today_hours: Math.round(hours * 100) / 100,
      today_miles: Math.round(miles * 100) / 100,
      today_earnings: Math.round(earnings * 100) / 100,
      hourly_rate: driver.hourly_rate,
      /** Server timestamp of the currently open shift, if any. The client
       *  counts up from this so a refresh never resets the clock. */
      open_shift_started_at: openSince,
    };
  });

/** Called during a shift to bump GPS miles (client already tracks them). */
export const addShiftMiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { delta_miles: number }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);
    const { data: open } = await supabaseAdmin
      .from("driver_shifts")
      .select("id, gps_miles")
      .eq("driver_id", driver.id)
      .is("clock_out_at", null)
      .maybeSingle();
    if (!open) return null;
    const next = Number(open.gps_miles ?? 0) + Math.max(0, data.delta_miles);
    await supabaseAdmin.from("driver_shifts").update({ gps_miles: next }).eq("id", open.id);
    return { gps_miles: next };
  });
