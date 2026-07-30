import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Record metadata for a gas receipt whose photo the client already uploaded
 *  to the `gas-receipts` bucket under `<user_id>/<filename>`. */
export const submitGasReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      amount: number;
      gallons?: number | null;
      photo_path: string;
      notes?: string | null;
      shift_id?: string | null;
    }) => {
      if (!input.amount || input.amount <= 0) throw new Error("Amount required");
      if (!input.photo_path) throw new Error("Photo required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!driver) throw new Error("Driver profile not found");
    const { data: row, error } = await supabaseAdmin
      .from("gas_receipts")
      .insert({
        driver_id: driver.id,
        amount: data.amount,
        gallons: data.gallons ?? null,
        photo_path: data.photo_path,
        notes: data.notes ?? null,
        shift_id: data.shift_id ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyGasReceipts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!driver) return [];
    const { data } = await supabaseAdmin
      .from("gas_receipts")
      .select("*")
      .eq("driver_id", driver.id)
      .order("submitted_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });

/** Staff view of gas receipts. Visible to BOTH admin and dispatch — an
 *  expense record contains no pay-rate data. */
export const listStaffGasReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { driver_id?: string | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const set = new Set((roles ?? []).map((r) => r.role));
    const isAdmin = set.has("admin");
    if (!isAdmin && !set.has("dispatch")) throw new Error("Staff only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("gas_receipts")
      .select("id, driver_id, amount, gallons, photo_path, notes, submitted_at, reimbursed_at")
      .order("submitted_at", { ascending: false })
      .limit(200);
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const driverIds = [...new Set((rows ?? []).map((r) => r.driver_id))];
    const { data: drivers } = driverIds.length
      ? await supabaseAdmin.from("drivers").select("id, user_id").in("id", driverIds)
      : { data: [] as { id: string; user_id: string }[] };
    const userIds = (drivers ?? []).map((d) => d.user_id).filter(Boolean);
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, first_name, last_name").in("id", userIds)
      : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
    const pByUser = new Map((profiles ?? []).map((p) => [p.id, p]));
    const nameByDriver = new Map(
      (drivers ?? []).map((d) => {
        const p = pByUser.get(d.user_id);
        return [d.id, `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Driver"];
      }),
    );

    const out = [];
    for (const r of rows ?? []) {
      const { data: signed } = await supabaseAdmin.storage
        .from("gas-receipts")
        .createSignedUrl(r.photo_path, 3600);
      out.push({
        ...r,
        amount: Number(r.amount),
        driver_name: nameByDriver.get(r.driver_id) ?? "Driver",
        photo_url: signed?.signedUrl ?? null,
      });
    }
    return { can_reimburse: isAdmin, receipts: out };
  });

/** Mark a gas expense reimbursed. ADMIN ONLY. */
export const markGasReceiptReimbursed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { receipt_id: string; reimbursed: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!isAdmin) throw new Error("Admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("gas_receipts")
      .update({
        reimbursed_at: data.reimbursed ? new Date().toISOString() : null,
        reimbursed_by: data.reimbursed ? context.userId : null,
      })
      .eq("id", data.receipt_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
