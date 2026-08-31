import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ELIGIBLE_PROVIDER_ROLES,
  evaluateBillingSetup,
  type BillingSetupStatus,
  type ProviderCandidate,
} from "@/lib/billingSetup";

/**
 * Onboarding server functions for a company that has NOT been set up yet.
 * None of these throw when configuration is missing — a new company must be
 * able to open Billing and fix its own setup. Secret values are never read
 * or returned here.
 */

async function guard(supabase: any, userId: string) {
  const { assertBilling } = await import("@/lib/billingHelpers");
  await assertBilling(supabase, userId);
  const { requireCompanyId } = await import("@/lib/company.server");
  return requireCompanyId(userId);
}

/**
 * Eligible providers = active profiles of the CURRENT company holding an
 * admin / billing / admin_biller role. Deliberately NOT derived from rate rows.
 */
export const listProviderCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderCandidate[]> => {
    const { supabase, userId } = context;
    const companyId = await guard(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, email, is_active, company_id")
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).filter((p: any) => p.is_active !== false).map((p: any) => p.id);
    if (!ids.length) return [];

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids)
      .in("role", ELIGIBLE_PROVIDER_ROLES as unknown as any);

    const byUser = new Map<string, string[]>();
    for (const r of (roles ?? []) as any[]) {
      byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
    }

    return (profiles ?? [])
      .filter((p: any) => byUser.has(p.id))
      .map((p: any) => ({
        id: p.id,
        name:
          [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
          p.email ||
          "Unnamed user",
        email: p.email ?? null,
        roles: byUser.get(p.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

/** Readiness of this company's billing configuration. Never throws on empty. */
export const getBillingSetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await guard(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [settingsRes, credsRes, ratesRes] = await Promise.all([
      supabaseAdmin
        .from("billing_settings")
        .select("default_portal_id, default_provider_id")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabaseAdmin.from("state_portal_credentials").select("portal_id").eq("company_id", companyId),
      supabaseAdmin
        .from("billing_rate_settings")
        .select("vehicle_type, unit_type")
        .eq("company_id", companyId),
    ]);

    const settings = (settingsRes.data ?? null) as any;
    const status: BillingSetupStatus = evaluateBillingSetup({
      providerId: settings?.default_provider_id ?? null,
      portalId: settings?.default_portal_id ?? null,
      credentialPortalIds: ((credsRes.data ?? []) as any[]).map((c) => c.portal_id),
      rates: ((ratesRes.data ?? []) as any[]).map((r) => ({
        vehicle_type: r.vehicle_type,
        unit_type: r.unit_type,
      })),
    });

    return {
      company_id: companyId,
      default_provider_id: (settings?.default_provider_id ?? null) as string | null,
      default_portal_id: (settings?.default_portal_id ?? null) as string | null,
      ...status,
    };
  });

/**
 * Save the company's billing provider. The database function re-validates that
 * the person is an active admin/billing member of THIS company, so a
 * cross-company id can never be stored even if the client sends one.
 */
export const setBillingProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ provider_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await guard(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id, is_active")
      .eq("id", data.provider_id)
      .maybeSingle();
    if (!prof || (prof as any).company_id !== companyId) {
      throw new Error("That user does not belong to this company.");
    }

    const { error } = await supabase.rpc("set_default_billing_provider", {
      _provider_id: data.provider_id,
      _company_id: companyId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, provider_id: data.provider_id };
  });
