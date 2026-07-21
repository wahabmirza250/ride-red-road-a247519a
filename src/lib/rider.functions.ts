import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Resolves the value that should appear in the state PDF's
 * "Member Health First Colorado ID #" field for a rider.
 *
 * - If the rider has a real Medicaid ID on file, return it.
 * - Otherwise, the rider was booked with SSN + DOB. If the caller is an
 *   admin OR the driver assigned to the given trip, decrypt and return
 *   the full SSN from Vault so it can be written into the same field.
 * - Falls back to `SSN-XXXX` (last 4) when no full SSN is on file.
 *
 * SSN never leaves the server unless the caller is authorized.
 */
export const getRiderIdentifierForPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rider_id: string; trip_id?: string }) => {
    if (!d?.rider_id) throw new Error("rider_id required");
    return { rider_id: d.rider_id, trip_id: d.trip_id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, medicaid_id, last_4_ssn")
      .eq("id", data.rider_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rider) throw new Error("rider not found");

    const raw = (rider.medicaid_id ?? "").trim();
    const isPlaceholder = raw.startsWith("SSN-") || raw.startsWith("WALK-");
    if (raw && !isPlaceholder) {
      return { identifier: raw, source: "medicaid_id" as const };
    }

    // Placeholder / missing Medicaid ID → need SSN. Authorize the caller.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    let allowed = !!isAdmin;
    if (!allowed && data.trip_id) {
      const { data: trip } = await supabase
        .from("medicaid_trips")
        .select("driver_id")
        .eq("id", data.trip_id)
        .maybeSingle();
      if (trip?.driver_id === userId) allowed = true;
    }
    if (!allowed) throw new Error("not authorized to read identifier");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ssn } = await supabaseAdmin.rpc("get_decrypted_rider_ssn", {
      _rider_id: data.rider_id,
    });
    if (ssn && typeof ssn === "string") {
      return { identifier: ssn, source: "ssn_full" as const };
    }
    if (rider.last_4_ssn) {
      return { identifier: `SSN-${rider.last_4_ssn}`, source: "ssn_last4" as const };
    }
    return { identifier: raw, source: "placeholder" as const };
  });
