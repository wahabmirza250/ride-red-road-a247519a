import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  earningsInWindow,
  isStaleOpenShift,
  roundHours,
  shiftHours,
  startOfDayMs,
  sumHoursInWindow,
  MAX_SHIFT_HOURS,
  type ShiftRow,
} from "@/lib/shiftTime";

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

type ShiftRecord = ShiftRow & {
  id: string;
  gps_miles?: number | string | null;
  earnings?: number | string | null;
};

/** The driver's currently running shift, if any. */
async function openShiftFor(driverId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("driver_shifts")
    .select("*")
    .eq("driver_id", driverId)
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ShiftRecord | null) ?? null;
}

/**
 * Closes a shift a driver forgot to end, capped at the safety limit, so one
 * forgotten shift can never swallow every later day's hours.
 */
async function closeStaleShift(open: ShiftRecord | null, rate: number | null) {
  if (!open || !isStaleOpenShift(open, Date.now())) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const endMs = Date.parse(open.clock_in_at) + MAX_SHIFT_HOURS * 3_600_000;
  const hours = MAX_SHIFT_HOURS;
  const hourlyRate = Number(open.hourly_rate_snapshot ?? rate ?? 0) || 0;
  await supabaseAdmin
    .from("driver_shifts")
    .update({
      clock_out_at: new Date(endMs).toISOString(),
      earnings: Math.round(hours * hourlyRate * 100) / 100,
    })
    .eq("id", open.id)
    .is("clock_out_at", null);
  return open.id;
}

/** Start a shift. Repeated taps return the shift that is already running. */
export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { start_odometer?: number | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);

    const existing = await openShiftFor(driver.id);
    if (existing) {
      const closed = await closeStaleShift(existing, driver.hourly_rate);
      if (!closed) return existing;
    }

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
    const open = await openShiftFor(driver.id);
    if (!open) return null;

    const now = new Date();
    const hours = shiftHours(open, now.getTime());
    const miles = data.gps_miles ?? Number(open.gps_miles ?? 0);
    const rate = Number(open.hourly_rate_snapshot ?? driver.hourly_rate ?? 0) || 0;
    const earnings = Math.round(hours * rate * 100) / 100;

    // The `is("clock_out_at", null)` filter makes a second tap a no-op instead
    // of a second, shorter shift record.
    const { data: closed, error } = await supabaseAdmin
      .from("driver_shifts")
      .update({
        clock_out_at: now.toISOString(),
        end_odometer: data.end_odometer ?? open.end_odometer ?? null,
        gps_miles: miles,
        earnings,
      })
      .eq("id", open.id)
      .is("clock_out_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return closed ?? null;
  });

/** Named for the driver-facing controls; same records payroll already reads. */
export const startShift = clockIn;
export const endShift = clockOut;

export const getCurrentShift = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const driver = await getDriver(context.userId);
    const open = await openShiftFor(driver.id);
    return { shift: open, hourly_rate: driver.hourly_rate, pay_type: driver.pay_type };
  });

/**
 * Everything the driver home screen shows about today: hours, miles, earnings
 * and whether a shift is running. Hours are derived from stored timestamps and
 * clipped to today, so a shift that started yesterday still counts correctly.
 */
export const getShiftStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);

    const stale = await openShiftFor(driver.id);
    await closeStaleShift(stale, driver.hourly_rate);

    const now = Date.now();
    const dayStart = startOfDayMs(now);
    // Reach back far enough to catch a shift that began before midnight.
    const lookback = new Date(dayStart - 48 * 3_600_000).toISOString();
    const { data } = await supabaseAdmin
      .from("driver_shifts")
      .select("id, clock_in_at, clock_out_at, gps_miles, earnings, hourly_rate_snapshot")
      .eq("driver_id", driver.id)
      .gte("clock_in_at", lookback)
      .order("clock_in_at", { ascending: false });

    const rows = (data ?? []) as ShiftRecord[];
    const todayRows = rows.filter((r) => {
      const end = r.clock_out_at ? Date.parse(r.clock_out_at) : now;
      return end > dayStart;
    });

    const openRow = rows.find((r) => !r.clock_out_at) ?? null;
    const closedToday = todayRows.filter((r) => r.clock_out_at);

    const hours = sumHoursInWindow(todayRows, dayStart, now, now);
    const closedHours = sumHoursInWindow(closedToday, dayStart, now, now);
    const miles = todayRows.reduce((t, r) => t + Number(r.gps_miles ?? 0), 0);
    const earnings = earningsInWindow(todayRows, dayStart, now, now, driver.hourly_rate);
    const closedEarnings = earningsInWindow(closedToday, dayStart, now, now, driver.hourly_rate);

    return {
      today_hours: roundHours(hours),
      today_miles: Math.round(miles * 100) / 100,
      today_earnings: earnings,
      hourly_rate: driver.hourly_rate,
      /** Hours already banked today from finished shifts. */
      closed_hours_today: roundHours(closedHours),
      closed_earnings_today: closedEarnings,
      /** When the running shift began, or null when no shift is running. */
      open_shift_started_at: openRow?.clock_in_at ?? null,
      /** Where today's live count starts (handles an overnight shift). */
      day_started_at: new Date(dayStart).toISOString(),
      open_shift_rate:
        openRow == null
          ? null
          : Number(openRow.hourly_rate_snapshot ?? driver.hourly_rate ?? 0) || 0,
    };
  });

/** Called during a shift to bump GPS miles (client already tracks them). */
export const addShiftMiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { delta_miles: number }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const driver = await getDriver(context.userId);
    const open = await openShiftFor(driver.id);
    if (!open) return null;
    const next = Number(open.gps_miles ?? 0) + Math.max(0, data.delta_miles);
    await supabaseAdmin.from("driver_shifts").update({ gps_miles: next }).eq("id", open.id);
    return { gps_miles: next };
  });
