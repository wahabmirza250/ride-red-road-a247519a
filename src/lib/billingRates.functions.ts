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
    const row = {
      provider_id: context.userId,
      vehicle_type: data.vehicle_type,
      procedure_code: data.procedure_code.trim(),
      charge_amount: Number(data.charge_amount),
      unit_type: data.unit_type,
      place_of_service: data.place_of_service?.trim() || null,
    };
    const { data: saved, error } = await (context.supabase as any)
      .from("billing_rate_settings")
      .upsert(row, { onConflict: "provider_id,vehicle_type,unit_type" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return saved as BillingRateSetting;
  });

export const upsertBillingRatePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      vehicle_type: VehicleType;
      place_of_service?: string | null;
      trip: { procedure_code: string; charge_amount: number };
      mile: { procedure_code: string; charge_amount: number };
    }) => {
      if (!["ambulatory", "wheelchair_van"].includes(input.vehicle_type)) {
        throw new Error("Invalid vehicle type");
      }
      for (const section of ["trip", "mile"] as const) {
        const s = input[section];
        if (!s || !s.procedure_code?.trim()) {
          throw new Error(`${section === "trip" ? "Trip" : "Mile"} Procedure Code is required`);
        }
        if (
          s.charge_amount === undefined ||
          s.charge_amount === null ||
          Number.isNaN(s.charge_amount) ||
          s.charge_amount < 0
        ) {
          throw new Error(
            `${section === "trip" ? "Trip" : "Mile"} Charge Amount is required and must be >= 0`,
          );
        }
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const pos = data.place_of_service?.trim() || null;
    const rows = [
      {
        provider_id: context.userId,
        vehicle_type: data.vehicle_type,
        unit_type: "trip" as UnitType,
        procedure_code: data.trip.procedure_code.trim(),
        charge_amount: Number(data.trip.charge_amount),
        place_of_service: pos,
      },
      {
        provider_id: context.userId,
        vehicle_type: data.vehicle_type,
        unit_type: "mile" as UnitType,
        procedure_code: data.mile.procedure_code.trim(),
        charge_amount: Number(data.mile.charge_amount),
        place_of_service: pos,
      },
    ];
    const { data: saved, error } = await (context.supabase as any)
      .from("billing_rate_settings")
      .upsert(rows, { onConflict: "provider_id,vehicle_type,unit_type" })
      .select("*");
    if (error) throw new Error(error.message);
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
