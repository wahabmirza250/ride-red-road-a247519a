/**
 * Company-scoped EDI setup server functions.
 *
 * Reads/writes ONLY non-secret configuration. SFTP passwords and keys are
 * never accepted here — the UI shows "Secure credential setup required" for
 * those until a secure server-side write endpoint exists.
 *
 * A platform owner may administer any onboarded company; every other user is
 * pinned to their own company. That decision is made server-side in
 * `resolveEdiScope`, never from a company id sent by the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMPTY_EDI_SETTINGS, type EdiCompanySettings } from "@/lib/ediSetup";
import type { EdiCompanyOption } from "@/lib/ediCompany.server";

export type { EdiCompanyOption } from "@/lib/ediCompany.server";

const TABLE = "edi_company_settings";

const nullableText = z.string().trim().max(300).nullable().optional();
const CompanyScope = { company_id: z.string().uuid().nullable().optional() };

const SettingsSchema = z.object({
  ...CompanyScope,
  billing_name: nullableText,
  provider_identifier_type: z.enum(["npi", "health_first_colorado_id"]).optional(),
  medicaid_provider_id: nullableText,
  npi: nullableText,
  taxonomy_code: nullableText,
  tax_id: nullableText,
  address_line1: nullableText,
  address_line2: nullableText,
  city: nullableText,
  state: nullableText,
  postal_code: nullableText,
  phone: nullableText,
  contact_name: nullableText,
  contact_email: nullableText,
  sender_id: nullableText,
  receiver_id: nullableText,
  environment: z.enum(["test", "production"]).optional(),
  transport_mode: z.enum(["shared", "company"]).optional(),
  production_enabled: z.boolean().optional(),
  sftp_host: nullableText,
  sftp_port: z.number().int().min(1).max(65535).nullable().optional(),
  sftp_username: nullableText,
  sftp_directory: nullableText,
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** EDI setup for the caller's company, or another company for a platform owner. */
export const getEdiCompanySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object(CompanyScope).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<EdiCompanySettings> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { data: row } = await supabase
      .from(TABLE)
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!row) return { company_id: companyId, ...EMPTY_EDI_SETTINGS };
    return { ...EMPTY_EDI_SETTINGS, ...(row as object) } as EdiCompanySettings;
  });

/** Save non-secret provider / trading-partner configuration for one company. */
export const saveEdiCompanySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<EdiCompanySettings> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const patch: Record<string, unknown> = { company_id: companyId };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || k === "company_id") continue;
      patch[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
    }

    // Live submission is a deliberate act: it can only be turned on for a
    // company whose provider + trading-partner + transport setup is complete.
    if (patch["production_enabled"] === true) {
      const { evaluateEdiSetup } = await import("@/lib/ediSetup");
      const merged = { ...EMPTY_EDI_SETTINGS, ...(patch as object) } as EdiCompanySettings;
      const status = evaluateEdiSetup(merged);
      if (!status.providerReady || !status.tradingPartnerReady) {
        throw new Error(
          `Cannot enable production yet: ${status.issues.map((i) => i.message).join("; ")}`,
        );
      }
    }

    const { data: existing } = await supabase
      .from(TABLE)
      .select("id")
      .eq("company_id", companyId)
      .maybeSingle();

    const row = patch as never;
    const query = existing?.id
      ? supabase.from(TABLE).update(row).eq("id", existing.id).select("*").single()
      : supabase.from(TABLE).insert(row).select("*").single();

    const { data: saved, error } = await query;
    if (error) throw new Error(error.message);
    return { ...EMPTY_EDI_SETTINGS, ...(saved as object) } as EdiCompanySettings;
  });

/** Companies the caller may administer EDI setup for. */
export const listEdiCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      companies: EdiCompanyOption[];
      isPlatformOwner: boolean;
      ownCompanyId: string | null;
    }> => {
      const { supabase, userId } = context;
      const { listScopedCompanies } = await import("@/lib/ediCompany.server");
      return listScopedCompanies(supabase, userId);
    },
  );
