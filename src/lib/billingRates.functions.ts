import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VehicleType = "ambulatory" | "wheelchair_van";
export type UnitType = "trip" | "mile";

export interface BillingRateSetting {
  id: string;
  provider_id: string | null;
  company_id: string | null;
  vehicle_type: VehicleType;
  procedure_code: string;
  charge_amount: number;
  unit_type: UnitType;
  place_of_service: string | null;
  default_diagnosis_code: string | null;
  updated_at: string;
}

export interface BillingRatesView {
  company_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  /** "legacy" = rows that predate tenant scoping and still apply. */
  scope: "company" | "legacy";
  rows: BillingRateSetting[];
}

/**
 * Authorisation for rate management.
 *
 * Rates belong to the company being edited, not to the signed-in user. A
 * billing admin may manage their OWN company only; the platform owner may
 * target any company explicitly.
 */
async function authorizeRateAccess(
  supabase: any,
  userId: string,
  requestedCompanyId?: string | null,
): Promise<string> {
  const { assertBilling } = await import("@/lib/billingHelpers");
  await assertBilling(supabase, userId);
  const { requireCompanyId, isPlatformOwner } = await import("@/lib/company.server");
  const own = await requireCompanyId(userId);
  if (!requestedCompanyId || requestedCompanyId === own) return own;
  if (await isPlatformOwner(userId)) return requestedCompanyId;
  throw new Error("You cannot manage billing rates for another company.");
}

async function providerName(supabaseAdmin: any, providerId: string | null) {
  if (!providerId) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", providerId)
    .maybeSingle();
  if (!data) return null;
  return (
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || data.email || null
  );
}

export const listBillingRateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<BillingRatesView> => {
    const companyId = await authorizeRateAccess(context.supabase, context.userId, data.company_id);
    const { loadRateRows } = await import("@/lib/billingRates.server");
    const { resolveBillingProviderId } = await import("@/lib/providerResolve.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { rows, scope } = await loadRateRows(supabaseAdmin as any, { companyId });
    const provider =
      (await resolveBillingProviderId(supabaseAdmin as any, companyId)) ??
      ((rows[0]?.provider_id as string | undefined) ?? null);

    return {
      company_id: companyId,
      provider_id: provider,
      provider_name: await providerName(supabaseAdmin, provider),
      scope,
      rows: rows as BillingRateSetting[],
    };
  });

export const upsertBillingRatePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      company_id?: string | null;
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
    const companyId = await authorizeRateAccess(context.supabase, context.userId, data.company_id);
    const { saveRatePair } = await import("@/lib/billingRates.server");
    const { resolveBillingProviderId, PROVIDER_NOT_ASSIGNED_MESSAGE } = await import(
      "@/lib/providerResolve.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Rates are stamped with the company's ACTUAL billing provider, never the
    // admin who happens to be editing the screen.
    const providerId = await resolveBillingProviderId(supabaseAdmin as any, companyId);
    if (!providerId) throw new Error(PROVIDER_NOT_ASSIGNED_MESSAGE);

    const saved = await saveRatePair(supabaseAdmin as any, {
      company_id: companyId,
      provider_id: providerId,
      vehicle_type: data.vehicle_type,
      default_diagnosis_code: data.default_diagnosis_code,
      trip: data.trip,
      mile: data.mile,
    });
    return saved as BillingRateSetting[];
  });

export const deleteBillingRateSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; company_id?: string | null }) => {
    if (!input.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const companyId = await authorizeRateAccess(context.supabase, context.userId, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("billing_rate_settings")
      .delete()
      .eq("company_id", companyId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
