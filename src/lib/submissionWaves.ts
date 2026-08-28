/**
 * BATCH PROGRESS + LEGACY WAVE REPAIR (pure, client-safe).
 *
 * The old design parked everything beyond the first 20 bills of a batch with a
 * `submit_wave_hold` flag and a far-future `submit_next_attempt_at`. That could
 * strand legitimate queued work whenever the promoting scheduler did not run,
 * so it is GONE: a Submit now enqueues every selected bill as plain `queued`
 * and the leasing RPC decides how many actually run at once (per-account cap,
 * fleet capacity, one live claim per rider). Real portal concurrency is
 * unchanged; the difference is that nothing can sit invisible behind a gate.
 *
 * What is left here is (a) progress counting for the batch card and (b) the
 * constants needed to RELEASE any row that a previous build left held.
 */

export const DEFAULT_WAVE_SIZE = 20;
export const MAX_WAVE_SIZE = 50;

/** Far-future eligibility timestamp a previous build used to park a bill. */
export const WAVE_HOLD_UNTIL = "2999-01-01T00:00:00.000Z";

export const clampWaveSize = (n: unknown): number => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_WAVE_SIZE;
  return Math.min(MAX_WAVE_SIZE, Math.max(1, v));
};

export type WaveCounts = {
  total: number;
  /** Rows a previous build left held. Always released on the next tick. */
  waiting: number;
  /** Eligible or already running: queued + submitting. */
  active: number;
  /** Reached a terminal outcome (submitted / paid / approved / needs attention). */
  completed: number;
};

/** Human progress line, e.g. "20 of 100 completed · 12 still sending". */
export function waveProgressLabel(c: WaveCounts): string {
  const head = `${c.completed} of ${c.total} completed`;
  if (c.active > 0 || c.waiting > 0) return `${head} · ${c.active + c.waiting} still sending`;
  return `${head} · batch finished`;
}

export const isWaveBatchDone = (c: WaveCounts) => c.waiting === 0 && c.active === 0;
