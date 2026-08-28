/**
 * Wave orchestration (server-only). See `submissionWaves.ts` for the rules.
 *
 * Nothing here ever touches a bill that is `submitting`, and nothing here ever
 * changes status, idempotency keys, account keys or attempt counters. Releasing
 * a wave only clears the hold flag and the far-future eligibility timestamp.
 */
import {
  DEFAULT_WAVE_SIZE,
  WAVE_HOLD_UNTIL,
  clampWaveSize,
  waveReleaseCount,
  type WaveCounts,
} from "@/lib/submissionWaves";

type Sb = any;

/** Park every id beyond the first wave. Called right after a batch enqueue. */
export async function holdBeyondFirstWave(
  supabase: Sb,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const { error } = await supabase
    .from("billing_records")
    .update({ submit_wave_hold: true, submit_next_attempt_at: WAVE_HOLD_UNTIL })
    .in("id", ids)
    .eq("status", "queued");
  if (error) return 0;
  return ids.length;
}

export function countWave(rows: Array<{ status?: string | null; submit_wave_hold?: boolean | null }>): WaveCounts {
  let waiting = 0;
  let active = 0;
  let completed = 0;
  for (const r of rows) {
    const status = String(r.status ?? "");
    if (status === "queued" && r.submit_wave_hold) waiting++;
    else if (status === "queued" || status === "submitting") active++;
    else completed++;
  }
  return { total: rows.length, waiting, active, completed };
}

/**
 * Release the next slice of ONE batch. Returns how many bills became eligible.
 * Idempotent and safe to call from every scheduler tick.
 */
export async function promoteBatchWave(
  supabase: Sb,
  batchId: string,
  waveSize = DEFAULT_WAVE_SIZE,
): Promise<number> {
  const { data: rows, error } = await supabase
    .from("billing_records")
    .select("id, status, submit_wave_hold, created_at")
    .eq("submit_batch_id", batchId);
  if (error || !rows?.length) return 0;

  const counts = countWave(rows);
  if (counts.waiting === 0) return 0;

  const room = waveReleaseCount(counts.active, waveSize);
  if (room <= 0) return 0;

  const next = rows
    .filter((r: any) => r.submit_wave_hold && String(r.status) === "queued")
    .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .slice(0, room)
    .map((r: any) => r.id as string);
  if (!next.length) return 0;

  const { data: released } = await supabase
    .from("billing_records")
    .update({ submit_wave_hold: false, submit_next_attempt_at: null })
    .in("id", next)
    .eq("status", "queued")
    .eq("submit_wave_hold", true)
    .select("id");
  return (released ?? []).length;
}

/**
 * Release the next wave of every batch that still has held work.
 * Company-scoped when a company id is supplied.
 */
export async function promoteDueWaves(
  supabase: Sb,
  opts: { companyId?: string | null } = {},
): Promise<{ batches: number; released: number }> {
  let q = supabase
    .from("billing_records")
    .select("submit_batch_id")
    .eq("submit_wave_hold", true)
    .eq("status", "queued")
    .not("submit_batch_id", "is", null);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) return { batches: 0, released: 0 };

  const batchIds: string[] = [
    ...new Set((data ?? []).map((r: any) => String(r.submit_batch_id))),
  ] as string[];
  if (!batchIds.length) return { batches: 0, released: 0 };

  const { data: batches } = await supabase
    .from("submission_batches")
    .select("id, wave_size")
    .in("id", batchIds);
  const sizeOf = new Map<string, number>(
    (batches ?? []).map((b: any) => [String(b.id), clampWaveSize(b.wave_size ?? DEFAULT_WAVE_SIZE)]),
  );

  let released = 0;
  for (const id of batchIds) {
    released += await promoteBatchWave(supabase, id, sizeOf.get(id) ?? DEFAULT_WAVE_SIZE);
  }
  return { batches: batchIds.length, released };
}
