/**
 * Bulk EDI billing rules (pure).
 *
 * Super EDI is a high-volume workspace: a biller selects 20–100+ bills, runs
 * one validation pass, then builds ONE 837P from every claim the backend
 * called ready. These helpers decide what goes in and what is held back —
 * a single bad claim must never block the ready ones.
 */

export type EdiRowLike = {
  record_id: string;
  edi_claim_id: number | null;
  edi_batch_id: number | null;
  edi_file_id: number | null;
  edi_status: string | null;
  /** Backend readiness (`ready` from POST /claims/{id}/validate/). */
  edi_ready: boolean | null;
  /** Backend validation messages, already flattened. */
  edi_issues: string[];
  edi_last_error: string | null;
  /** Data the backend cannot fix for us (missing Medicaid ID, no rate, …). */
  local_blockers: string[];
};

export type EdiRowState =
  | "not_validated"
  | "ready"
  | "needs_attention"
  | "error"
  | "batched"
  | "generated"
  | "uploaded";

/** Where one bill stands in the EDI pipeline. */
export function ediRowState(row: EdiRowLike): EdiRowState {
  const status = (row.edi_status ?? "").toLowerCase();
  if (status === "uploaded" || status === "submitted") return "uploaded";
  if (row.edi_file_id) return "generated";
  if (row.edi_batch_id) return "batched";
  if (row.edi_last_error) return "error";
  if (row.local_blockers.length) return "needs_attention";
  if (row.edi_ready === true) return "ready";
  if (row.edi_ready === false) return "needs_attention";
  return "not_validated";
}

export const EDI_ROW_STATE_LABEL: Record<EdiRowState, string> = {
  not_validated: "Not validated",
  ready: "Ready",
  needs_attention: "Needs attention",
  error: "Error",
  batched: "In batch",
  generated: "837P generated",
  uploaded: "Uploaded",
};

/** Only a backend-confirmed `ready === true` claim may enter a batch. */
export function isBatchReady(row: EdiRowLike): boolean {
  return row.edi_ready === true && !!row.edi_claim_id && row.local_blockers.length === 0;
}

export type EdiExclusion = { record_id: string; reason: string };

export type EdiBatchPartition = {
  ready: EdiRowLike[];
  excluded: EdiExclusion[];
};

/**
 * Splits the selected rows into "goes into this 837P" and "held back, with the
 * precise reason". Never throws, never silently drops a row.
 */
export function partitionForBatch(rows: EdiRowLike[]): EdiBatchPartition {
  const ready: EdiRowLike[] = [];
  const excluded: EdiExclusion[] = [];
  for (const row of rows) {
    if (isBatchReady(row)) {
      ready.push(row);
      continue;
    }
    excluded.push({ record_id: row.record_id, reason: exclusionReason(row) });
  }
  return { ready, excluded };
}

export function exclusionReason(row: EdiRowLike): string {
  if (row.local_blockers.length) return row.local_blockers[0]!;
  if (!row.edi_claim_id) return "No EDI claim yet — run Validate first";
  if (row.edi_ready === false)
    return row.edi_issues[0] ?? row.edi_last_error ?? "Backend says this claim is not ready";
  if (row.edi_last_error) return row.edi_last_error;
  return "Not validated yet";
}

export type EdiBatchCounts = {
  selected: number;
  ready: number;
  excluded: number;
  alreadyBatched: number;
};

export function batchCounts(rows: EdiRowLike[]): EdiBatchCounts {
  const { ready, excluded } = partitionForBatch(rows);
  return {
    selected: rows.length,
    ready: ready.length,
    excluded: excluded.length,
    alreadyBatched: rows.filter((r) => !!r.edi_batch_id).length,
  };
}

export type EdiBatchPlan =
  | { action: "none"; reason: string }
  | { action: "reuse"; batch_id: number; file_id: number | null; record_ids: string[] }
  | { action: "create"; record_ids: string[] };

/**
 * Idempotency: clicking "Build 837P" twice must not create a second batch or a
 * second file. When every ready row already carries the same batch id we reuse
 * it (and its generated file, when there is one).
 */
export function planBatch(rows: EdiRowLike[]): EdiBatchPlan {
  const { ready } = partitionForBatch(rows);
  if (!ready.length) return { action: "none", reason: "No claim in this selection is ready" };

  const batchIds = new Set(ready.map((r) => r.edi_batch_id).filter((v): v is number => !!v));
  const recordIds = ready.map((r) => r.record_id);

  if (batchIds.size === 1 && ready.every((r) => !!r.edi_batch_id)) {
    const batchId = [...batchIds][0]!;
    const fileIds = new Set(ready.map((r) => r.edi_file_id).filter((v): v is number => !!v));
    return {
      action: "reuse",
      batch_id: batchId,
      file_id: fileIds.size === 1 ? [...fileIds][0]! : null,
      record_ids: recordIds,
    };
  }

  // Mixed / partially batched selections start a new batch for the rows that
  // are not in one yet; already-batched rows keep their existing batch.
  const unbatched = ready.filter((r) => !r.edi_batch_id).map((r) => r.record_id);
  if (!unbatched.length) return { action: "none", reason: "Every ready claim is already batched" };
  return { action: "create", record_ids: unbatched };
}

export type EdiValidationOutcome = {
  record_id: string;
  ok: boolean;
  ready: boolean | null;
  message?: string;
};

export type EdiValidationSummary = {
  total: number;
  ready: number;
  needsAttention: number;
  error: number;
};

/** Result banner after a "Validate All" pass. */
export function summarizeValidation(results: EdiValidationOutcome[]): EdiValidationSummary {
  let ready = 0;
  let needsAttention = 0;
  let error = 0;
  for (const r of results) {
    if (!r.ok) error += 1;
    else if (r.ready === true) ready += 1;
    else needsAttention += 1;
  }
  return { total: results.length, ready, needsAttention, error };
}

/** Rows a biller should open and fix, in the order they should be fixed. */
export function attentionRows(rows: EdiRowLike[]): EdiRowLike[] {
  const rank: Record<EdiRowState, number> = {
    error: 0,
    needs_attention: 1,
    not_validated: 2,
    ready: 3,
    batched: 4,
    generated: 5,
    uploaded: 6,
  };
  return rows
    .filter((r) => ["error", "needs_attention"].includes(ediRowState(r)))
    .sort((a, b) => rank[ediRowState(a)] - rank[ediRowState(b)]);
}
