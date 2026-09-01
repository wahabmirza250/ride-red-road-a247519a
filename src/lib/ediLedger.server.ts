/**
 * SERVER ONLY — RedArt's own record of what exists in the EDI backend.
 *
 *   edi_company_mapping  one row per company: its provider profile, trading
 *                        partner and (optional) transport credential ids.
 *   edi_entity_links     rider -> EDI patient, trip -> EDI NEMT trip, per
 *                        environment. This is what makes a re-sync idempotent:
 *                        an existing link is reused, never re-created.
 *   edi_batches          every submission batch this company built, so a batch
 *                        or 837P file id can always be traced back to its owner.
 *
 * Every read and write is scoped by `company_id`, and the tables' RLS policies
 * enforce the same scope a second time.
 */
import type { EdiEnvironment } from "@/lib/ediSetup";

type Sb = any;

/* ------------------------------------------------------------------ */
/* Company mapping                                                     */
/* ------------------------------------------------------------------ */

export type EdiCompanyMapping = {
  company_id: string;
  environment: EdiEnvironment;
  edi_provider_profile_id: string | null;
  edi_trading_partner_id: string | null;
  edi_sftp_credentials_id: string | null;
  trading_partner_mode: "shared" | "company";
  provider_fingerprint: string | null;
  trading_partner_fingerprint: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
};

export const EMPTY_MAPPING: Omit<EdiCompanyMapping, "company_id"> = {
  environment: "test",
  edi_provider_profile_id: null,
  edi_trading_partner_id: null,
  edi_sftp_credentials_id: null,
  trading_partner_mode: "shared",
  provider_fingerprint: null,
  trading_partner_fingerprint: null,
  last_synced_at: null,
  last_sync_error: null,
};

const MAPPING_COLUMNS =
  "company_id, environment, edi_provider_profile_id, edi_trading_partner_id, edi_sftp_credentials_id, trading_partner_mode, provider_fingerprint, trading_partner_fingerprint, last_synced_at, last_sync_error";

export async function loadCompanyMapping(
  supabase: Sb,
  companyId: string,
): Promise<EdiCompanyMapping> {
  const { data, error } = await supabase
    .from("edi_company_mapping")
    .select(MAPPING_COLUMNS)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { company_id: companyId, ...EMPTY_MAPPING };
  return { ...EMPTY_MAPPING, ...(data as Record<string, unknown>) } as EdiCompanyMapping;
}

/** Upsert on `company_id` — repeat saves update the same row, never duplicate. */
export async function saveCompanyMapping(
  supabase: Sb,
  companyId: string,
  patch: Partial<Omit<EdiCompanyMapping, "company_id">>,
): Promise<EdiCompanyMapping> {
  const { error } = await supabase
    .from("edi_company_mapping")
    .upsert({ company_id: companyId, ...patch } as never, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
  return loadCompanyMapping(supabase, companyId);
}

/* ------------------------------------------------------------------ */
/* Entity links (patient / trip)                                       */
/* ------------------------------------------------------------------ */

export type EdiEntityKindLink = "patient" | "trip";

export type EdiEntityLink = {
  entity_type: EdiEntityKindLink;
  local_id: string;
  edi_entity_id: string;
  fingerprint: string | null;
};

export async function loadEntityLinks(
  supabase: Sb,
  companyId: string,
  entityType: EdiEntityKindLink,
  localIds: string[],
  environment: EdiEnvironment,
): Promise<Map<string, EdiEntityLink>> {
  const ids = [...new Set(localIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { chunk } = await import("@/lib/dbChunk");
  const out = new Map<string, EdiEntityLink>();
  for (const part of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("edi_entity_links")
      .select("entity_type, local_id, edi_entity_id, fingerprint")
      .eq("company_id", companyId)
      .eq("entity_type", entityType)
      .eq("environment", environment)
      .in("local_id", part);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as EdiEntityLink[]) out.set(row.local_id, row);
  }
  return out;
}

export async function saveEntityLink(
  supabase: Sb,
  companyId: string,
  link: {
    entity_type: EdiEntityKindLink;
    local_id: string;
    edi_entity_id: string | number;
    environment: EdiEnvironment;
    fingerprint?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("edi_entity_links").upsert(
    {
      company_id: companyId,
      entity_type: link.entity_type,
      local_id: link.local_id,
      edi_entity_id: String(link.edi_entity_id),
      environment: link.environment,
      fingerprint: link.fingerprint ?? null,
    } as never,
    { onConflict: "company_id,entity_type,local_id,environment" },
  );
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Batch ledger                                                        */
/* ------------------------------------------------------------------ */

export type EdiBatchLedgerRow = {
  id: string;
  batch_number: string;
  environment: EdiEnvironment;
  trading_partner: string | null;
  edi_batch_id: number | null;
  edi_file_id: number | null;
  status: string;
  record_ids: string[];
  claim_count: number;
  last_error: string | null;
  created_at: string;
};

const BATCH_COLUMNS =
  "id, batch_number, environment, trading_partner, edi_batch_id, edi_file_id, status, record_ids, claim_count, last_error, created_at";

export async function openBatchLedger(
  supabase: Sb,
  companyId: string,
  input: {
    batch_number: string;
    environment: EdiEnvironment;
    trading_partner: string | null;
    record_ids: string[];
    created_by: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("edi_batches")
    .insert({
      company_id: companyId,
      batch_number: input.batch_number,
      environment: input.environment,
      trading_partner: input.trading_partner,
      record_ids: input.record_ids,
      claim_count: input.record_ids.length,
      status: "creating",
      created_by: input.created_by,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateBatchLedger(
  supabase: Sb,
  companyId: string,
  ledgerId: string,
  patch: Partial<{
    edi_batch_id: number | null;
    edi_file_id: number | null;
    status: string;
    record_ids: string[];
    claim_count: number;
    last_error: string | null;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from("edi_batches")
    .update(patch as never)
    .eq("id", ledgerId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

/** Records the outcome of handing an 837P file to transport. */
export async function markBatchUploaded(
  supabase: Sb,
  companyId: string,
  fileId: number,
  ok: boolean,
  error: string | null,
): Promise<void> {
  const { error: dbError } = await supabase
    .from("edi_batches")
    .update({ status: ok ? "uploaded" : "upload_failed", last_error: error } as never)
    .eq("company_id", companyId)
    .eq("edi_file_id", fileId);
  if (dbError) throw new Error(dbError.message);
}

export async function listBatchLedger(
  supabase: Sb,
  companyId: string,
  limit = 20,
): Promise<EdiBatchLedgerRow[]> {
  const { data, error } = await supabase
    .from("edi_batches")
    .select(BATCH_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EdiBatchLedgerRow[];
}
