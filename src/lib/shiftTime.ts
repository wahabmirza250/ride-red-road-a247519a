/**
 * Work-hour math for driver shifts.
 *
 * A shift is a pair of server timestamps (clock in, clock out). Hours are
 * always calculated from those timestamps, never from a timer running in the
 * app, so a refresh, a phone restart or an overnight shift can never lose or
 * invent time. Payroll reads exactly the same numbers.
 */

export type ShiftRow = {
  clock_in_at: string;
  clock_out_at: string | null;
  hourly_rate_snapshot?: number | string | null;
};

/** Safety net for a shift a driver forgot to end. */
export const MAX_SHIFT_HOURS = 16;

const HOUR_MS = 3_600_000;

export function startOfDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Total worked hours of one shift, counting an open shift up to `now`. */
export function shiftHours(row: ShiftRow, now: number): number {
  const start = Date.parse(row.clock_in_at);
  if (!Number.isFinite(start)) return 0;
  const end = row.clock_out_at ? Date.parse(row.clock_out_at) : now;
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / HOUR_MS);
}

/**
 * Hours of one shift that fall inside a window — this is what makes an
 * overnight shift count correctly towards today instead of disappearing.
 */
export function hoursInWindow(
  row: ShiftRow,
  windowStart: number,
  windowEnd: number,
  now: number,
): number {
  const start = Date.parse(row.clock_in_at);
  if (!Number.isFinite(start)) return 0;
  const rawEnd = row.clock_out_at ? Date.parse(row.clock_out_at) : now;
  if (!Number.isFinite(rawEnd)) return 0;
  const from = Math.max(start, windowStart);
  const to = Math.min(rawEnd, windowEnd);
  return Math.max(0, (to - from) / HOUR_MS);
}

export function sumHoursInWindow(
  rows: ShiftRow[],
  windowStart: number,
  windowEnd: number,
  now: number,
): number {
  return rows.reduce((total, r) => total + hoursInWindow(r, windowStart, windowEnd, now), 0);
}

export function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

/** Earnings for hourly drivers, based on the hours actually inside the window. */
export function earningsInWindow(
  rows: ShiftRow[],
  windowStart: number,
  windowEnd: number,
  now: number,
  fallbackRate: number | null,
): number {
  let total = 0;
  for (const r of rows) {
    const rate = Number(r.hourly_rate_snapshot ?? fallbackRate ?? 0) || 0;
    total += hoursInWindow(r, windowStart, windowEnd, now) * rate;
  }
  return Math.round(total * 100) / 100;
}

/** True when an open shift has run past the safety limit and should be closed. */
export function isStaleOpenShift(row: ShiftRow, now: number): boolean {
  return !row.clock_out_at && shiftHours(row, now) > MAX_SHIFT_HOURS;
}

/** Formats hours for the driver as e.g. "6h 42m". */
export function formatHours(hours: number): string {
  const safe = Math.max(0, hours);
  const h = Math.floor(safe);
  const m = Math.round((safe - h) * 60);
  if (m === 60) return `${h + 1}h 0m`;
  return `${h}h ${m}m`;
}
