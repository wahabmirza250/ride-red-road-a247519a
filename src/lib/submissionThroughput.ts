/**
 * THROUGHPUT TELEMETRY (pure, UI-facing).
 *
 * Everything here is derived from timestamps we already store on
 * `billing_records` — no new instrumentation, no portal calls, no writes.
 * The numbers shown to billers are always the MEASURED numbers; the 60s/claim
 * figure is only ever displayed as a target, never as a promise.
 */

export const TARGET_SECONDS_PER_CLAIM = 60;

/** One finished claim as shown in the Done / Completed section. */
export type DoneClaim = {
  id: string;
  tripId: string | null;
  status: string;
  claimId: string | null;
  completedAt: string | null;
  batchId: string | null;
  batchLabel: string | null;
  biller: string | null;
  passenger: string | null;
};

export type ThroughputSummary = {
  /** Completions used for the rolling window. */
  sampleSize: number;
  /** Measured average seconds per completed claim, or null when unknown. */
  avgSecondsPerClaim: number | null;
  claimsPerHour: number | null;
  /** Estimated seconds until the current queue drains. */
  etaSeconds: number | null;
  meetsTarget: boolean | null;
};

/** Sorted ascending epoch-ms list of completion times. */
export function completionTimestamps(rows: Pick<DoneClaim, "completedAt">[]): number[] {
  return rows
    .map((r) => (r.completedAt ? new Date(r.completedAt).getTime() : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * Rolling seconds-per-claim. Measured as elapsed wall clock across the most
 * recent completions divided by the number of intervals, which is the only
 * honest reading of end-to-end throughput for a single-flight account lane.
 */
export function rollingAvgSecondsPerClaim(
  timesMs: number[],
  windowSize = 20,
): number | null {
  const w = timesMs.slice(-Math.max(2, windowSize));
  if (w.length < 2) return null;
  const span = w[w.length - 1]! - w[0]!;
  if (!Number.isFinite(span) || span <= 0) return null;
  return Math.round(span / 1000 / (w.length - 1));
}

export function claimsPerHour(avgSecondsPerClaim: number | null): number | null {
  if (!avgSecondsPerClaim || avgSecondsPerClaim <= 0) return null;
  return Math.round(3600 / avgSecondsPerClaim);
}

export function etaSeconds(
  pendingCount: number,
  avgSecondsPerClaim: number | null,
): number | null {
  if (pendingCount <= 0) return 0;
  if (!avgSecondsPerClaim || avgSecondsPerClaim <= 0) return null;
  return Math.round(pendingCount * avgSecondsPerClaim);
}

export function throughputSummary(
  rows: Pick<DoneClaim, "completedAt">[],
  pendingCount: number,
  opts: { windowSize?: number } = {},
): ThroughputSummary {
  const times = completionTimestamps(rows);
  const avg = rollingAvgSecondsPerClaim(times, opts.windowSize ?? 20);
  const sample = Math.min(times.length, opts.windowSize ?? 20);
  return {
    sampleSize: times.length >= 2 ? sample : times.length,
    avgSecondsPerClaim: avg,
    claimsPerHour: claimsPerHour(avg),
    etaSeconds: etaSeconds(pendingCount, avg),
    meetsTarget: avg == null ? null : avg <= TARGET_SECONDS_PER_CLAIM,
  };
}

/** "1h 12m" / "45s" style label for durations expressed in seconds. */
export function formatSeconds(total: number | null): string {
  if (total == null || !Number.isFinite(total) || total < 0) return "—";
  if (total < 60) return `${Math.round(total)}s`;
  const mins = Math.round(total / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/** Case-insensitive search across the safe fields shown in the Done table. */
export function filterDoneClaims(rows: DoneClaim[], query: string): DoneClaim[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.claimId, r.batchLabel, r.biller, r.passenger, r.status, r.tripId]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q)),
  );
}
