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
  password?: string;
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

async function ensureAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
) {
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
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
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
        company_id: companyId,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");

    const userId = created.user.id;

    // Trigger has assigned 'passenger' by default (since admins already exist).
    // Force role to driver.
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "driver", company_id: companyId },
        { onConflict: "user_id,role" },
      );
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).neq("role", "driver");

    // Update profile with any info the trigger may have missed
    await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        company_id: companyId,
      })
      .eq("id", userId);

    // Create/update driver row (trigger may have already inserted one)
    const { error: dErr } = await supabaseAdmin.from("drivers").upsert(
      {
        user_id: userId,
        company_id: companyId,
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

export const deleteDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id: string }) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { data: d } = await supabaseAdmin
      .from("drivers")
      .select("user_id")
      .eq("id", data.driver_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!d?.user_id) throw new Error("Driver not found");
    const uid = d.user_id;
    await supabaseAdmin.from("trips").update({ driver_id: null }).eq("driver_id", data.driver_id);
    await supabaseAdmin.from("drivers").delete().eq("id", data.driver_id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.auth.admin.deleteUser(uid);
    return { ok: true };
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
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
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
        company_id: companyId,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");
    const userId = created.user.id;
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "admin", company_id: companyId },
        { onConflict: "user_id,role" },
      );
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).neq("role", "admin");
    await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? "",
        company_id: companyId,
      })
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

type CreateDispatcherInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
};

/**
 * Owner/admin creates a dispatcher login. Dispatchers get the `dispatch`
 * role ONLY — never admin — so they can never reach billing, payroll or
 * portal credentials.
 */
export const createDispatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateDispatcherInput) => {
    if (!input.email?.trim()) throw new Error("Email required");
    if (!input.password || input.password.length < 6)
      throw new Error("Password must be at least 6 characters");
    return input;
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? "",
        role: "dispatch",
        company_id: companyId,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");
    const userId = created.user.id;
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "dispatch", company_id: companyId },
        { onConflict: "user_id,role" },
      );
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).neq("role", "dispatch");
    await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? "",
        company_id: companyId,
      })
      .eq("id", userId);
    return { ok: true, user_id: userId };
  });

export const listDispatchers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "dispatch");
    const ids = (roles ?? []).map((r) => r.user_id);
    if (!ids.length) return [];
    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, first_name, last_name, email, phone")
      .in("id", ids);
    return profs ?? [];
  });

export const deleteDispatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => {
    if (!input?.user_id) throw new Error("user_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .eq("role", "dispatch")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!role) throw new Error("Not a dispatcher account");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    return { ok: true };
  });

export const createPassengerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreatePassengerInput) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.password && (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()) || data.password.length < 6)) {
      throw new Error("A valid email and password of at least 6 characters are required for app access.");
    }
    const payload = {
      company_id: companyId, first_name: data.first_name.trim(), last_name: data.last_name.trim(),
      medicaid_id: data.medicaid_id?.trim() || null, date_of_birth: data.date_of_birth || null,
      phone: data.phone || null, email: data.email?.trim().toLowerCase() || null,
      county: data.county || null, address: data.address || null, notes: data.notes || null,
    };
    if (!payload.first_name || !payload.last_name || !payload.medicaid_id) throw new Error("Name and Medicaid ID are required.");
    if (data.password) {
      const { data: account, error: accountError } = await supabaseAdmin.auth.admin.createUser({
        email: payload.email!, password: data.password, email_confirm: true,
        user_metadata: { first_name: payload.first_name, last_name: payload.last_name, phone: payload.phone, role: "passenger", company_id: companyId },
      });
      if (accountError || !account.user) throw new Error(accountError?.message ?? "Could not create passenger login");
      const { data: passenger, error } = await supabaseAdmin.from("passengers")
        .update(payload).eq("user_id", account.user.id).eq("company_id", companyId).select("id").single();
      if (error) {
        await supabaseAdmin.auth.admin.deleteUser(account.user.id);
        throw new Error("Could not finish creating passenger login. Please try again.");
      }
      return { ok: true, id: passenger.id };
    }
    const { data: inserted, error } = await supabaseAdmin.from("passengers").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

// Payroll: hours × $15 + fuel reimbursement + trip count
type PayrollInput = { driver_id: string; from: string; to: string };
export const getPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PayrollInput) => input)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { buildPreview } = await import("@/lib/payroll.functions");
    if (
      !Number.isFinite(Date.parse(data.from)) ||
      !Number.isFinite(Date.parse(data.to)) ||
      Date.parse(data.to) <= Date.parse(data.from)
    )
      throw new Error("Invalid pay period");
    const { driver, plan, calc, issues, work } = await buildPreview(
      context.supabase,
      companyId,
      data.driver_id,
      data.from,
      data.to,
    );
    if (issues.length) throw new Error("Pay plan needs attention: " + issues.join("; "));
    const { data: shifts, error } = work.shift_ids.length
      ? await context.supabase
          .from("driver_shifts")
          .select("id,clock_in_at,clock_out_at")
          .in("id", work.shift_ids)
      : { data: [], error: null };
    if (error) throw new Error(error.message);
    return {
      driver: { first_name: driver.name, last_name: "", email: driver.email },
      period: { from: data.from, to: data.to },
      plan: plan.plan,
      lines: calc.lines,
      hourly_rate: calc.hourly_rate,
      hours: calc.hours,
      hourly_pay: calc.hourly_pay,
      trips_completed: calc.trip_count,
      miles: null as number | null,
      fuel_cost: calc.fuel,
      total: calc.total,
      shifts: (shifts ?? []).map((sh) => ({
        id: sh.id,
        start: sh.clock_in_at,
        end: sh.clock_out_at,
        status: "Clocked",
      })),
    };
  });

type CreateBillingUserInput = CreateDispatcherInput & {
  /** "billing" = sees only their own bills. "admin_biller" = sees every bill in the company. */
  role?: "billing" | "admin_biller";
};

export const createBillingUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateBillingUserInput) => {
    if (!input.email?.trim()) throw new Error("Email required");
    if (!input.password || input.password.length < 6)
      throw new Error("Password must be at least 6 characters");
    const role = input.role === "admin_biller" ? "admin_biller" : "billing";
    return { ...input, role } as CreateBillingUserInput & { role: "billing" | "admin_biller" };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const role = data.role === "admin_biller" ? "admin_biller" : "billing";
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? "",
        role,
        company_id: companyId,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");
    const userId = created.user.id;
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role, company_id: companyId }, { onConflict: "user_id,role" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).neq("role", role);
    await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? "",
        company_id: companyId,
      })
      .eq("id", userId);
    return { ok: true, user_id: userId, role };
  });

export const listBillingUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["billing", "admin_biller"]);
    const ids = (roles ?? []).map((r) => r.user_id);
    if (!ids.length) return [];
    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, first_name, last_name, email, phone")
      .in("id", ids);
    const roleOf = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]));
    return (profs ?? []).map((p) => ({ ...p, role: roleOf.get(p.id) ?? "billing" }));
  });

export const deleteBillingUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => {
    if (!input?.user_id) throw new Error("user_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .in("role", ["billing", "admin_biller"])
      .eq("company_id", companyId)
      .maybeSingle();
    if (!role) throw new Error("Not a billing account");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    return { ok: true };
  });

/** Admin resets a driver's password directly from the driver profile.
 *  Scoped to the admin's own company so one tenant can never touch another's
 *  accounts. */
export const resetDriverPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driver_id: string; password: string }) => {
    if (!input.driver_id) throw new Error("Driver required");
    if (!input.password || input.password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: d } = await supabaseAdmin
      .from("drivers")
      .select("user_id")
      .eq("id", data.driver_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!d?.user_id) throw new Error("Driver not found in your company");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(d.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
