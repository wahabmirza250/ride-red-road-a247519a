/**
 * AUTOMATIC WAVES.
 *
 * A biller may select 100+ bills and click Submit once. Everything is enqueued
 * durably in one go (idempotency keys, account keys, duplicate collapse all
 * unchanged), but only a bounded WAVE is made eligible for leasing at a time.
 * As bills in the wave reach a terminal outcome, the next ones are released
 * automatically until the batch is exhausted.
 *
 * A wave size is a MAXIMUM, never a fixed batch: when fewer than `waveSize`
 * items remain, ALL of them are taken (47 runs as 20, 20, 7; 13 runs as 13).
 *
 * A wave is NOT a concurrency setting. Real portal concurrency is still decided
 * by the per-account cap, the fleet capacity and the one-live-claim-per-rider
 * rule. The wave only limits how much of a batch is *eligible* at once, so the
 * queue stays readable and a huge batch cannot starve other billers.
 *
 * Held rows stay `queued` with a far-future `submit_next_attempt_at`, which the
 * leasing RPC already respects, plus an explicit `submit_wave_hold` flag. All
 * of it lives in Postgres, so a refresh or a restart changes nothing.
 */

export const DEFAULT_WAVE_SIZE = 20;
export const MAX_WAVE_SIZE = 50;

/** Far-future eligibility timestamp used to park a held bill. */
export const WAVE_HOLD_UNTIL = "2999-01-01T00:00:00.000Z";

export const clampWaveSize = (n: unknown): number => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_WAVE_SIZE;
  return Math.min(MAX_WAVE_SIZE, Math.max(1, v));
};

/** Split an ordered list of enqueued ids into the first wave and the held rest. */
export function splitIntoWaves<T>(ids: T[], waveSize: number): { release: T[]; hold: T[] } {
  const size = clampWaveSize(waveSize);
  return { release: ids.slice(0, size), hold: ids.slice(size) };
}

/** How many held bills may be released right now. */
export function waveReleaseCount(activeInBatch: number, waveSize: number): number {
  return Math.max(0, clampWaveSize(waveSize) - Math.max(0, Math.floor(activeInBatch)));
}

export type WaveCounts = {
  total: number;
  /** Held back, not yet eligible. */
  waiting: number;
  /** Eligible or already running: queued (released) + submitting. */
  active: number;
  /** Reached a terminal outcome (submitted / paid / approved / needs attention). */
  completed: number;
};

/** Human progress line, e.g. "20 of 100 completed · processing next wave". */
export function waveProgressLabel(c: WaveCounts): string {
  const head = `${c.completed} of ${c.total} completed`;
  if (c.waiting > 0) return `${head} · processing next wave (${c.waiting} waiting)`;
  if (c.active > 0) return `${head} · ${c.active} in the current wave`;
  return `${head} · batch finished`;
}

export const isWaveBatchDone = (c: WaveCounts) => c.waiting === 0 && c.active === 0;
