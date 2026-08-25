import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPENSE_CATEGORIES, insuranceState } from "@/lib/compliance";

const CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value) as [string, ...string[]];

async function myDriverRow(supabase: any, userId: string) {
  const { data } = await supabase
    .from("drivers")
    .select("id, company_id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { id: string; company_id: string | null } | null) ?? null;
}

async function isStaff(supabase: any, userId: string) {
  const [{ data: a }, { data: b }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "dispatch" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin_biller" }),
  ]);
  return !!a || !!b || !!c;
}

/**
 * Resolve which driver a write applies to. A driver may only ever write their
 * own rows; staff may write for any driver in their own company (RLS enforces
 * the same rule a second time).
 */
async function targetDriver(supabase: any, userId: string, driverId?: string | null) {
  const mine = await myDriverRow(supabase, userId);
  if (!driverId || (mine && driverId === mine.id)) {
    if (!mine) throw new Error("No driver profile for this account.");
    return mine;
  }
  if (!(await isStaff(supabase, userId))) throw new Error("Forbidden: not your driver record.");
  const { data } = await supabase
    .from("drivers")
    .select("id, company_id")
    .eq("id", driverId)
    .maybeSingle();
  if (!data) throw new Error("Driver not found.");
  return data as { id: string; company_id: string | null };
}

// ---------------------------------------------------------------- insurance

const insuranceInput = z.object({
  id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  insurer: z.string().min(1),
  policy_number: z.string().min(1),
  vehicle_label: z.string().optional().nullable(),
  vehicle_plate: z.string().optional().nullable(),
  effective_date: z.string().optional().nullable(),
  expiration_date: z.string(),
  document_path: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const upsertInsuranceDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => insuranceInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const driver = await targetDriver(supabase, userId, data.driver_id ?? null);

    const row = {
      company_id: driver.company_id,
      driver_id: driver.id,
      insurer: data.insurer,
      policy_number: data.policy_number,
      vehicle_label: data.vehicle_label ?? null,
      vehicle_plate: data.vehicle_plate ?? null,
      effective_date: data.effective_date ? data.effective_date.slice(0, 10) : null,
      expiration_date: data.expiration_date.slice(0, 10),
      document_path: data.document_path ?? null,
      notes: data.notes ?? null,
      created_by: userId,
    };

    if (data.id) {
      // Editing resets verification: the document changed.
      const { error } = await supabase
        .from("driver_insurance_docs")
        .update({ ...row, status: "pending", verified_by: null, verified_at: null })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabase
      .from("driver_insurance_docs")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const listInsuranceDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ driver_id: z.string().uuid().optional(), only_alerts: z.boolean().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let q = supabase.from("driver_insurance_docs").select("*").order("expiration_date", { ascending: true });
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    const { data: rows, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    void userId;

    const withState = ((rows ?? []) as any[]).map((r) => ({
      ...r,
      state: insuranceState(r.expiration_date),
    }));
    return data.only_alerts
      ? withState.filter((r) => r.state === "expiring_soon" || r.state === "expired")
      : withState;
  });

/** Company staff approve or reject a submitted insurance document. */
export const verifyInsuranceDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["pending", "verified", "rejected"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!(await isStaff(supabase, userId))) throw new Error("Forbidden: admin or dispatch only");
    const { error } = await supabase
      .from("driver_insurance_docs")
      .update({
        status: data.status,
        verified_by: data.status === "pending" ? null : userId,
        verified_at: data.status === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------------------------------------------------------- vehicle expenses

const expenseInput = z.object({
  driver_id: z.string().uuid().optional(),
  vehicle_label: z.string().optional().nullable(),
  vehicle_plate: z.string().optional().nullable(),
  expense_date: z.string(),
  category: z.enum(CATEGORY_VALUES),
  amount: z.number().min(0),
  odometer: z.number().min(0).optional().nullable(),
  vendor: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  receipt_path: z.string().optional().nullable(),
});

export const createVehicleExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => expenseInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const driver = await targetDriver(supabase, userId, data.driver_id ?? null);
    const { data: created, error } = await supabase
      .from("vehicle_expenses")
      .insert({
        company_id: driver.company_id,
        driver_id: driver.id,
        vehicle_label: data.vehicle_label ?? null,
        vehicle_plate: data.vehicle_plate ?? null,
        expense_date: data.expense_date.slice(0, 10),
        category: data.category,
        amount: Math.round(data.amount * 100) / 100,
        odometer: data.odometer ?? null,
        vendor: data.vendor ?? null,
        notes: data.notes ?? null,
        receipt_path: data.receipt_path ?? null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const listVehicleExpenses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        driver_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        category: z.enum(CATEGORY_VALUES).optional(),
        vehicle: z.string().optional(),
        page: z.number().int().min(0).default(0),
        page_size: z.number().int().min(10).max(200).default(50),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let q = supabase.from("vehicle_expenses").select("*", { count: "exact" });
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    if (data.from) q = q.gte("expense_date", data.from.slice(0, 10));
    if (data.to) q = q.lte("expense_date", data.to.slice(0, 10));
    if (data.category) q = q.eq("category", data.category);
    if (data.vehicle) q = q.ilike("vehicle_label", `%${data.vehicle}%`);

    const start = data.page * data.page_size;
    const { data: rows, error, count } = await q
      .order("expense_date", { ascending: false })
      .range(start, start + data.page_size - 1);
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as any[], total: count ?? 0 };
  });

export const deleteVehicleExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.from("vehicle_expenses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
