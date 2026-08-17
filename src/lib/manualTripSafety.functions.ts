import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Safety pre-flight checks for driver-created (manual) NEMT trips.
 *
 * These reuse the exact same rules already enforced elsewhere:
 *  - fail-closed on missing billing rates for the chosen vehicle type
 *  - read-only portal Medicaid ID verification (same robot lookup the paper
 *    bill flow uses; never guesses or auto-corrects an ID)
 */

export type RateCheck = {
  ok: boolean;
  missing: string[];
  vehicle_type: string;
};

export const checkVehicleRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { vehicle_type: string }) => {
    const vehicle_type = (input?.vehicle_type ?? "").trim();
    if (!vehicle_type) throw new Error("vehicle_type required");
    return { vehicle_type };
  })
  .handler(async ({ data, context }): Promise<RateCheck> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("billing_rate_settings")
      .select("unit_type")
      .eq("vehicle_type", data.vehicle_type);
    if (error) throw new Error(error.message);

    const have = new Set(((rows ?? []) as { unit_type: string }[]).map((r) => r.unit_type));
    const missing = (["trip", "mile"] as const).filter((u) => !have.has(u));
    return { ok: missing.length === 0, missing, vehicle_type: data.vehicle_type };
  });

export type RiderVerifyResult = {
  status: "matched" | "mismatch" | "unavailable" | "skipped";
  message: string;
  portal_name: string | null;
};

export const verifyRiderIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rider_id: string }) => {
    if (!input?.rider_id) throw new Error("rider_id required");
    return { rider_id: input.rider_id };
  })
  .handler(async ({ data, context }): Promise<RiderVerifyResult> => {
    const { supabase, userId } = context;

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, full_name, medicaid_id, company_id")
      .eq("id", data.rider_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rider) throw new Error("Passenger not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertPaperBillIdentity, PaperBillVerificationError, isRealMedicaidId } =
      await import("@/lib/paperBillVerify.server");

    if (!isRealMedicaidId(rider.medicaid_id)) {
      return {
        status: "skipped",
        message:
          "No real Medicaid member ID on file for this passenger — the portal check can't run. The trip will still need admin review before billing.",
        portal_name: null,
      };
    }

    try {
      const res = await assertPaperBillIdentity({
        supabaseAdmin: supabaseAdmin as any,
        userId,
        medicaidId: rider.medicaid_id,
        paperName: rider.full_name,
        companyId: rider.company_id ?? null,
      });
      return {
        status: "matched",
        message: `Portal confirmed ${res.portal_name ?? rider.full_name}.`,
        portal_name: res.portal_name,
      };
    } catch (e) {
      if (e instanceof PaperBillVerificationError) {
        return {
          status: e.kind === "mismatch" ? "mismatch" : "unavailable",
          message: e.message,
          portal_name: e.portalName,
        };
      }
      return {
        status: "unavailable",
        message: e instanceof Error ? e.message : "Verification failed",
        portal_name: null,
      };
    }
  });
