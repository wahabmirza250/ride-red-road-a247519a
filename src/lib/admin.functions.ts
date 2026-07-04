import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreateDriverInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  license_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  vehicle_color: string | null;
};

type CreatePassengerInput = {
  first_name: string;
  last_name: string;
  medicaid_id: string;
  date_of_birth?: string | null;
  phone?: string | null;
  email?: string | null;
  county?: string | null;
  address?: string | null;
  notes?: string | null;
};

async function ensureAdmin(supabase: import("@supabase/supabase-js").SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Admin only");
}

export const createDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateDriverInput) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        role: "driver",
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");

    const userId = created.user.id;

    // Trigger has assigned 'passenger' by default (since admins already exist).
    // Force role to driver.
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "driver" }, { onConflict: "user_id,role" });
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .neq("role", "driver");

    // Update profile with any info the trigger may have missed
    await supabaseAdmin
      .from("profiles")
      .update({ first_name: data.first_name, last_name: data.last_name, phone: data.phone })
      .eq("id", userId);

    // Create/update driver row (trigger may have already inserted one)
    const { error: dErr } = await supabaseAdmin.from("drivers").upsert(
      {
        user_id: userId,
        license_number: data.license_number,
        vehicle_make: data.vehicle_make,
        vehicle_model: data.vehicle_model,
        vehicle_year: data.vehicle_year,
        vehicle_plate: data.vehicle_plate,
        vehicle_color: data.vehicle_color,
        status: "offline",
      },
      { onConflict: "user_id" },
    );
    if (dErr) throw new Error(dErr.message);

    return { ok: true, user_id: userId };
  });

type CreateAdminInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
};

export const createAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateAdminInput) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? "",
        role: "admin",
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");
    const userId = created.user.id;
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).neq("role", "admin");
    await supabaseAdmin
      .from("profiles")
      .update({ first_name: data.first_name, last_name: data.last_name, phone: data.phone ?? "" })
      .eq("id", userId);
    return { ok: true, user_id: userId };
  });

export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const ids = (roles ?? []).map((r) => r.user_id);
    if (!ids.length) return [];
    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, first_name, last_name, email, phone")
      .in("id", ids);
    return profs ?? [];
  });

export const createPassengerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreatePassengerInput) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("passengers")
      .insert({
        first_name: data.first_name,
        last_name: data.last_name,
        medicaid_id: data.medicaid_id,
        date_of_birth: data.date_of_birth ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        county: data.county ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted?.id };
  });

// Payroll: hours × $15 + fuel reimbursement + trip count
type PayrollInput = { driver_id: string; from: string; to: string };
export const getPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PayrollInput) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const s = context.supabase;
    const HOURLY = 15;

    const [{ data: trips }, { data: shifts }, { data: fuel }, { data: driver }] = await Promise.all([
      s
        .from("trips")
        .select("id, status, actual_pickup_time, actual_dropoff_time, computed_miles, gps_miles")
        .eq("driver_id", data.driver_id)
        .eq("status", "completed")
        .gte("actual_dropoff_time", data.from)
        .lte("actual_dropoff_time", data.to),
      s
        .from("shifts")
        .select("id, start_time, end_time, status")
        .eq("driver_id", data.driver_id)
        .gte("start_time", data.from)
        .lte("start_time", data.to),
      s
        .from("fuel_logs")
        .select("id, total_cost, log_date")
        .eq("driver_id", data.driver_id)
        .gte("log_date", data.from.slice(0, 10))
        .lte("log_date", data.to.slice(0, 10)),
      s
        .from("drivers")
        .select("id, user_id")
        .eq("id", data.driver_id)
        .single(),
    ]);

    let profile: { first_name: string | null; last_name: string | null; email: string | null } | null = null;
    if (driver?.user_id) {
      const { data: p } = await s
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", driver.user_id)
        .maybeSingle();
      profile = p;
    }

    let hours = 0;
    if (shifts && shifts.length) {
      hours = shifts.reduce((sum, sh) => {
        const start = new Date(sh.start_time).getTime();
        const end = new Date(sh.end_time).getTime();
        return sum + Math.max(0, (end - start) / 3_600_000);
      }, 0);
    } else if (trips) {
      hours = trips.reduce((sum, t) => {
        if (!t.actual_pickup_time || !t.actual_dropoff_time) return sum;
        const start = new Date(t.actual_pickup_time).getTime();
        const end = new Date(t.actual_dropoff_time).getTime();
        return sum + Math.max(0, (end - start) / 3_600_000);
      }, 0);
    }

    const fuelCost = (fuel ?? []).reduce((s, f) => s + Number(f.total_cost ?? 0), 0);
    const miles = (trips ?? []).reduce(
      (s, t) => s + Number(t.computed_miles ?? t.gps_miles ?? 0),
      0,
    );
    const hourlyPay = hours * HOURLY;
    const total = hourlyPay + fuelCost;

    return {
      driver: profile,
      period: { from: data.from, to: data.to },
      hourly_rate: HOURLY,
      hours: Number(hours.toFixed(2)),
      hourly_pay: Number(hourlyPay.toFixed(2)),
      trips_completed: trips?.length ?? 0,
      miles: Number(miles.toFixed(2)),
      fuel_cost: Number(fuelCost.toFixed(2)),
      shifts: (shifts ?? []).map((sh) => ({
        id: sh.id,
        start: sh.start_time,
        end: sh.end_time,
        status: sh.status,
      })),
      total: Number(total.toFixed(2)),
    };
  });
