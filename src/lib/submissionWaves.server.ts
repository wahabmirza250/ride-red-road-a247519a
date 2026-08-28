/**
 * BATCH COUNTING + LEGACY HOLD REPAIR (server-only).
 *
 * Nothing in the app parks bills any more. This module only:
 *   1. counts a batch for the progress card, and
 *   2. RELEASES any row a previous build left held, so queued work can never
 *      be stranded behind a wave gate.
 *
 * Releasing never changes status, idempotency keys, account keys or attempt
 * counters, and never touches a row that is `submitting`.
 */
import { WAVE_HOLD_UNTIL, type WaveCounts } from "@/lib/submissionWaves";

type Sb = any;

export function countWave(
  rows: Array<{ status?: string | null; submit_wave_hold?: boolean | null }>,
): WaveCounts {
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
 * Make every still-held queued bill eligible again. Idempotent, safe to call
 * from every scheduler tick, and scoped to one company when asked.
 */
export async function releaseStrandedHolds(
  supabase: Sb,
  opts: { companyId?: string | null } = {},
): Promise<{ released: number }> {
  let q = supabase
    .from("billing_records")
    .update({ submit_wave_hold: false, submit_next_attempt_at: null })
    .eq("status", "queued")
    .eq("submit_wave_hold", true);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q.select("id");
  if (error) return { released: 0 };
  return { released: (data ?? []).length };
}

/** Backwards-compatible name used by the queue tick. */
export const promoteDueWaves = async (
  supabase: Sb,
  opts: { companyId?: string | null } = {},
): Promise<{ batches: number; released: number }> => {
  const { released } = await releaseStrandedHolds(supabase, opts);
  return { batches: released > 0 ? 1 : 0, released };
};

/** Any bill parked with the far-future timestamp is, by definition, stranded. */
export const isStrandedHold = (row: { status?: string | null; submit_next_attempt_at?: string | null }) =>
  String(row.status ?? "") === "queued" && String(row.submit_next_attempt_at ?? "") === WAVE_HOLD_UNTIL;
