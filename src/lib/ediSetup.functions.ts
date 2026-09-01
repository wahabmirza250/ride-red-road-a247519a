/**
 * Company-scoped EDI setup server functions.
 *
 * Reads/writes ONLY non-secret configuration. SFTP passwords and keys are
 * never accepted here — the UI shows a "Backend connection required" state
 * for those until a secure server-side write endpoint exists.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMPTY_EDI_SETTINGS, type EdiCompanySettings } from "@/lib/ediSetup";

const TABLE = "edi_company_settings";

async function guard(supabase: any, userId: string): Promise<string> {
  const { assertBilling } = await import("@/lib/billingHelpers");
  await assertBilling(supabase, userId);
  const { requireCompanyId } = await import("@/lib/company.server");
  return requireCompanyId(userId);
}

const nullableText = z.string().trim().max(200).nullable().optional();

const SettingsSchema = z.object({
  billing_name: nullableText,
  npi: nullableText,
  taxonomy_code: nullableText,
  tax_id: nullableText,
  address_line1: nullableText,
  address_line2: nullableText,
  city: nullableText,
  state: nullableText,
  postal_code: nullableText,
  phone: nullableText,
  contact_email: nullableText,
  sender_id: nullableText,
  receiver_id: nullableText,
  environment: z.enum(["test", "production"]).optional(),
  sftp_host: nullableText,
  sftp_port: z.number().int().min(1).max(65535).nullable().optional(),
  sftp_username: nullableText,
  sftp_directory: nullableText,
});

/** Current company's EDI setup. Never throws when nothing is configured yet. */
export const getEdiCompanySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EdiCompanySettings> => {
    const { supabase, userId } = context;
    const companyId = await guard(supabase, userId);
    const { data } = await supabase
      .from(TABLE)
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return { company_id: companyId, ...EMPTY_EDI_SETTINGS };
    return data as unknown as EdiCompanySettings;
  });

/** Save non-secret provider / trading-partner configuration for this company. */
export const saveEdiCompanySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<EdiCompanySettings> => {
    const { supabase, userId } = context;
    const companyId = await guard(supabase, userId);

    const patch: Record<string, unknown> = { company_id: companyId };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      patch[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
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
    return saved as unknown as EdiCompanySettings;
  });
