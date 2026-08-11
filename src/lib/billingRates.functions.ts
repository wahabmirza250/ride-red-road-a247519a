import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VehicleType = "ambulatory" | "wheelchair_van";
export type UnitType = "trip" | "mile";

export interface BillingRateSetting {
  id: string;
  provider_id: string;
  vehicle_type: VehicleType;
  procedure_code: string;
  charge_amount: number;
  unit_type: UnitType;
  place_of_service: string | null;
  default_diagnosis_code: string | null;
  updated_at: string;
}

export const listBillingRateSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("billing_rate_settings")
      .select("*")
      .order("vehicle_type", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as BillingRateSetting[];
  });

export const upsertBillingRateSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      vehicle_type: VehicleType;
      procedure_code: string;
      charge_amount: number;
      unit_type: UnitType;
      place_of_service?: string | null;
    }) => {
      if (!input.procedure_code?.trim()) {
        throw new Error("Procedure Code is required");
      }
      if (
        input.charge_amount === undefined ||
        input.charge_amount === null ||
        Number.isNaN(input.charge_amount) ||
        input.charge_amount < 0
      ) {
        throw new Error("Charge Amount is required and must be >= 0");
      }
      if (!["ambulatory", "wheelchair_van"].includes(input.vehicle_type)) {
        throw new Error("Invalid vehicle type");
      }
      if (!["trip", "mile"].includes(input.unit_type)) {
        throw new Error("Invalid unit type");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { requireCompanyId } = await import("@/lib/company.server");
    const { saveRateRow } = await import("@/lib/billingRates.server");
    const companyId = await requireCompanyId(context.userId);
    const saved = await saveRateRow(context.supabase, {
      company_id: companyId,
      provider_id: context.userId,
      vehicle_type: data.vehicle_type,
      unit_type: data.unit_type,
      procedure_code: data.procedure_code.trim(),
      charge_amount: Number(data.charge_amount),
      place_of_service: data.place_of_service?.trim() || null,
    });
    return saved as BillingRateSetting;
  });

export const upsertBillingRatePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      vehicle_type: VehicleType;
      default_diagnosis_code: string;
      trip: { procedure_code: string; charge_amount: number; place_of_service: string };
      mile: { procedure_code: string; charge_amount: number; place_of_service: string };
    }) => {
      if (!["ambulatory", "wheelchair_van"].includes(input.vehicle_type)) {
        throw new Error("Invalid vehicle type");
      }
      if (!input.default_diagnosis_code?.trim()) {
        throw new Error("Default Diagnosis Code is required");
      }
      for (const section of ["trip", "mile"] as const) {
        const s = input[section];
        const label = section === "trip" ? "Trip" : "Mile";
        if (!s || !s.procedure_code?.trim()) {
          throw new Error(`${label} Procedure Code is required`);
        }
        if (
          s.charge_amount === undefined ||
          s.charge_amount === null ||
          Number.isNaN(s.charge_amount) ||
          s.charge_amount < 0
        ) {
          throw new Error(`${label} Charge Amount is required and must be >= 0`);
        }
        if (!s.place_of_service?.trim()) {
          throw new Error(`${label} Place of Service is required`);
        }
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { requireCompanyId } = await import("@/lib/company.server");
    const { saveRatePair } = await import("@/lib/billingRates.server");
    const companyId = await requireCompanyId(context.userId);
    const saved = await saveRatePair(context.supabase, {
      company_id: companyId,
      provider_id: context.userId,
      vehicle_type: data.vehicle_type,
      default_diagnosis_code: data.default_diagnosis_code,
      trip: data.trip,
      mile: data.mile,
    });
    return saved as BillingRateSetting[];
  });

export const deleteBillingRateSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("billing_rate_settings")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
