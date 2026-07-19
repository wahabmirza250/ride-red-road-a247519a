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
