/**
 * SERVER ONLY — one reader for a company's EDI setup row.
 *
 * Every server path (setup screen, bulk pipeline, backend sync) reads the same
 * row through here, so environment and production clearance can never diverge
 * between what the biller sees and what the submission code enforces. The
 * caller's company id always comes from `resolveEdiScope`, never the browser.
 */
import { EMPTY_EDI_SETTINGS, type EdiCompanySettings, type EdiEnvironment } from "@/lib/ediSetup";

type Sb = any;

const TABLE = "edi_company_settings";

export async function loadEdiCompanySettings(
  supabase: Sb,
  companyId: string,
): Promise<EdiCompanySettings> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { company_id: companyId, ...EMPTY_EDI_SETTINGS };
  return { ...EMPTY_EDI_SETTINGS, ...(data as object) } as EdiCompanySettings;
}

/** Environment + production clearance — from the DB, never from the browser. */
export async function loadEdiEnvironment(
  supabase: Sb,
  companyId: string,
): Promise<{ environment: EdiEnvironment; productionEnabled: boolean }> {
  const { data } = await supabase
    .from(TABLE)
    .select("environment, production_enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  return {
    environment: data?.environment === "production" ? "production" : "test",
    productionEnabled: data?.production_enabled === true,
  };
}
