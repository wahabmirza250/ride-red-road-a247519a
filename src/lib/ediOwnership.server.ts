/**
 * SERVER ONLY — tenant ownership of EDI backend resources.
 *
 * The EDI backend numbers its claims, batches and files sequentially, so an id
 * alone proves nothing: `claim 412` might belong to any company on the
 * platform. Before RedArt forwards ANY request that names such an id, one of
 * these assertions must prove the id is mapped to data this company owns:
 *
 *   claim  -> a `billing_records` row of that company carries `edi_claim_id`
 *   batch  -> a `billing_records` row or an `edi_batches` ledger row of that
 *             company carries `edi_batch_id`
 *   file   -> same, via `edi_file_id`
 *
 * The company id itself is never taken from the browser: it comes from
 * `resolveEdiScope`, which only lets a platform owner cross company lines.
 * "Not yours" and "does not exist" deliberately produce the same message.
 */
import { ediOwnershipMessage, ediUnlinkedMessage, parseEdiId } from "@/lib/ediGuard";

type Sb = any;

/** Thrown when a caller names an EDI resource their company does not own. */
export class EdiAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdiAccessError";
  }
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

/** Narrows a caller-supplied record id list to the ones this company owns. */
export async function ownedRecordIds(
  supabase: Sb,
  companyId: string,
  recordIds: string[],
): Promise<string[]> {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return [];
  const { chunk } = await import("@/lib/dbChunk");
  const out: string[] = [];
  for (const part of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("billing_records")
      .select("id")
      .eq("company_id", companyId)
      .is("resubmission_id", null)
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { id: string }[]) out.push(row.id);
  }
  return out;
}

/** Every requested record must belong to this company — otherwise nothing runs. */
export async function assertRecordsOwned(
  supabase: Sb,
  companyId: string,
  recordIds: string[],
): Promise<void> {
  const owned = new Set(await ownedRecordIds(supabase, companyId, recordIds));
  const missing = [...new Set(recordIds)].filter((id) => !owned.has(id));
  if (missing.length) {
    throw new EdiAccessError(
      `${missing.length} selected bill${missing.length === 1 ? "" : "s"} could not be found for this company.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Claim                                                               */
/* ------------------------------------------------------------------ */

/** The EDI claim id linked to one of this company's bills. */
export async function claimIdForRecord(
  supabase: Sb,
  companyId: string,
  recordId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("billing_records")
    .select("edi_claim_id")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .is("resubmission_id", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EdiAccessError("That bill could not be found for this company.");
  const claimId = parseEdiId((data as { edi_claim_id: unknown }).edi_claim_id);
  if (!claimId) throw new EdiAccessError(ediUnlinkedMessage());
  return claimId;
}

/** Reverse direction: which of this company's bills owns this claim id. */
export async function recordIdForClaim(
  supabase: Sb,
  companyId: string,
  claimId: number,
): Promise<string> {
  const { data, error } = await supabase
    .from("billing_records")
    .select("id")
    .eq("company_id", companyId)
    .eq("edi_claim_id", claimId)
    .is("resubmission_id", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EdiAccessError(ediOwnershipMessage("claim", claimId));
  return (data as { id: string }).id;
}

/**
 * Binds a freshly created EDI claim to the bill that caused it. The partial
 * unique index on `edi_claim_id` makes a second bill claiming the same id
 * impossible, so a duplicate is reported instead of silently overwriting.
 */
export async function bindClaimToRecord(
  supabase: Sb,
  companyId: string,
  recordId: string,
  claimId: number,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const { writeEdiState } = await import("@/lib/ediWrite.server");
  try {
    await writeEdiState(supabase, companyId, recordId, {
      edi_claim_id: claimId,
      ...patch,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/duplicate key|unique constraint|23505/i.test(message)) {
      throw new EdiAccessError(
        `EDI claim #${claimId} is already linked to another bill — it was not re-linked.`,
      );
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Batch / file                                                        */
/* ------------------------------------------------------------------ */

async function ownsThroughRecords(
  supabase: Sb,
  companyId: string,
  column: "edi_batch_id" | "edi_file_id",
  id: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("billing_records")
    .select("id")
    .eq("company_id", companyId)
    .eq(column, id)
    .is("resubmission_id", null)
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).length > 0;
}

async function ownsThroughLedger(
  supabase: Sb,
  companyId: string,
  column: "edi_batch_id" | "edi_file_id",
  id: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("edi_batches")
    .select("id")
    .eq("company_id", companyId)
    .eq(column, id)
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).length > 0;
}

export async function assertBatchOwned(
  supabase: Sb,
  companyId: string,
  batchId: number,
): Promise<void> {
  if (await ownsThroughRecords(supabase, companyId, "edi_batch_id", batchId)) return;
  if (await ownsThroughLedger(supabase, companyId, "edi_batch_id", batchId)) return;
  throw new EdiAccessError(ediOwnershipMessage("batch", batchId));
}

export async function assertFileOwned(
  supabase: Sb,
  companyId: string,
  fileId: number,
): Promise<void> {
  if (await ownsThroughRecords(supabase, companyId, "edi_file_id", fileId)) return;
  if (await ownsThroughLedger(supabase, companyId, "edi_file_id", fileId)) return;
  throw new EdiAccessError(ediOwnershipMessage("file", fileId));
}
