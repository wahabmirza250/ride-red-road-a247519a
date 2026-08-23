/**
 * Pure, deterministic payroll math. No I/O, no clock reads except where a
 * caller passes `now` explicitly — so every number is reproducible and
 * testable. All money is rounded to cents at the very end of a calculation.
 */

export type ShiftLike = {
  id: string;
  driver_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  payout_id?: string | null;
};

export type ReceiptLike = {
  id: string;
  driver_id: string;
  amount: number | string | null;
  submitted_at: string;
  reimbursed_at?: string | null;
  payout_id?: string | null;
};

export type PayoutLike = {
  driver_id: string;
  total_paid: number | string | null;
  paid_at: string;
  period_start: string;
  period_end: string;
  voided_at?: string | null;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Hours between two instants, never negative. */
export function shiftHours(clockIn: string, clockOut: string | null, now?: Date): number {
  const end = clockOut ? new Date(clockOut) : (now ?? new Date());
  const ms = end.getTime() - new Date(clockIn).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, ms / 3_600_000);
}

/** A shift counts toward a period when it *starts* inside it. Boundaries are
 *  inclusive of `from` and exclusive of the instant after `to`. */
export function shiftInPeriod(shift: ShiftLike, from: string, to: string): boolean {
  const t = new Date(shift.clock_in_at).getTime();
  return t >= new Date(from).getTime() && t <= new Date(to).getTime();
}

/** Payable hours: closed, unpaid shifts that start inside the period.
 *  Open shifts are never payable — you cannot pay time that is still running. */
export function payableHours(shifts: ShiftLike[], from: string, to: string) {
  let hours = 0;
  let openCount = 0;
  const ids: string[] = [];
  for (const s of shifts) {
    if (s.payout_id) continue;
    if (!shiftInPeriod(s, from, to)) continue;
    if (!s.clock_out_at) {
      openCount += 1;
      continue;
    }
    hours += shiftHours(s.clock_in_at, s.clock_out_at);
    ids.push(s.id);
  }
  return { hours: round2(hours), shiftIds: ids, openCount };
}

/** Unreimbursed fuel submitted inside the period. */
export function pendingFuel(receipts: ReceiptLike[], from: string, to: string) {
  let total = 0;
  const ids: string[] = [];
  for (const r of receipts) {
    if (r.reimbursed_at || r.payout_id) continue;
    const t = new Date(r.submitted_at).getTime();
    if (t < new Date(from).getTime() || t > new Date(to).getTime()) continue;
    total += Number(r.amount ?? 0);
    ids.push(r.id);
  }
  return { amount: round2(total), receiptIds: ids };
}

export function periodsOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string) {
  return (
    new Date(aFrom).getTime() <= new Date(bTo).getTime() &&
    new Date(aTo).getTime() >= new Date(bFrom).getTime()
  );
}

/** Live (non-voided) payouts whose period overlaps the window. */
export function payoutsInPeriod(payouts: PayoutLike[], from: string, to: string) {
  return payouts.filter(
    (p) => !p.voided_at && periodsOverlap(p.period_start, p.period_end, from, to),
  );
}

export type PayComputation = {
  hours: number;
  hourly_rate: number | null;
  gross_earnings: number | null;
  fuel: number;
  bonus: number;
  total: number | null;
};

/** The single source of truth for what a driver is owed for a period. */
export function computePay(input: {
  hours: number;
  hourly_rate: number | null;
  fuel: number;
  bonus?: number;
  include_fuel?: boolean;
}): PayComputation {
  const hours = round2(input.hours);
  const rate = input.hourly_rate == null ? null : Number(input.hourly_rate);
  const gross = rate == null ? null : round2(hours * rate);
  const fuel = input.include_fuel === false ? 0 : round2(input.fuel);
  const bonus = round2(input.bonus ?? 0);
  return {
    hours,
    hourly_rate: rate,
    gross_earnings: gross,
    fuel,
    bonus,
    total: gross == null ? null : round2(gross + fuel + bonus),
  };
}
