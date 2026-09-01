/**
 * SERVER ONLY — the ONLY writer of the `edi_*` columns on `billing_records`.
 *
 * Hard guarantees:
 *   - writes are always scoped to one company id (tenant isolation);
 *   - only `edi_*` columns are ever touched, so the legacy HCPF/robot
 *     workflow status, claim number and portal fields are untouched;
 *   - corrected resubmission rows (`resubmission_id is not null`) are never
 *     written by the EDI path.
 */

type Sb = any;

export type EdiStatePatch = {
  edi_claim_id?: number | null;
  edi_batch_id?: number | null;
  edi_file_id?: number | null;
  edi_status?: string | null;
  edi_validation?: unknown;
  edi_status_detail?: unknown;
  edi_environment?: string | null;
  edi_last_error?: string | null;
};

const ALLOWED = [
  "edi_claim_id",
  "edi_batch_id",
  "edi_file_id",
  "edi_status",
  "edi_validation",
  "edi_status_detail",
  "edi_environment",
  "edi_last_error",
] as const;

export async function writeEdiState(
  supabase: Sb,
  companyId: string,
  recordId: string,
  patch: EdiStatePatch,
): Promise<void> {
  const update: Record<string, unknown> = { edi_last_sync_at: new Date().toISOString() };
  for (const key of ALLOWED) {
    if (patch[key] !== undefined) update[key] = patch[key] ?? null;
  }

  const { error } = await supabase
    .from("billing_records")
    .update(update as never)
    .eq("id", recordId)
    .eq("company_id", companyId)
    .is("resubmission_id", null);
  if (error) throw new Error(error.message);
}

/** Same write, applied to many records of one company (used by bulk batching). */
export async function writeEdiStateMany(
  supabase: Sb,
  companyId: string,
  recordIds: string[],
  patch: EdiStatePatch,
): Promise<void> {
  if (!recordIds.length) return;
  const update: Record<string, unknown> = { edi_last_sync_at: new Date().toISOString() };
  for (const key of ALLOWED) {
    if (patch[key] !== undefined) update[key] = patch[key] ?? null;
  }

  const { chunk } = await import("@/lib/dbChunk");
  for (const ids of chunk(recordIds, 50)) {
    const { error } = await supabase
      .from("billing_records")
      .update(update as never)
      .in("id", ids)
      .eq("company_id", companyId)
      .is("resubmission_id", null);
    if (error) throw new Error(error.message);
  }
}
