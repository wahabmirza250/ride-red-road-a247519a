/**
 * CLAIM SANITY — pure guards against corrupt claim data reaching HCPF.
 *
 * Two OCR/odometer failure modes produced impossible claims in production:
 * a mileage figure far beyond any real local trip (a 24,665.12 "charge" came
 * from a 16,000-mile odometer delta), and a service date that is in the future
 * or years old. Both must park the bill in Needs Attention and must never be
 * picked up by automatic submission.
 */

/** Longest single billable NEMT trip we will ever send without a human OK. */
export const MAX_CLAIM_MILES = 52;
/** A service date older than this is almost certainly a data error. */
export const MAX_SERVICE_AGE_DAYS = 365;

export type SanityCandidate = {
  /** Total billable miles for the claim, when known. */
  billed_miles?: number | null;
  /** Trip / service date in any parseable form. */
  service_date?: string | Date | null;
};

export type SanityIssue =
  | { code: "miles_out_of_range"; message: string }
  | { code: "invalid_service_date"; message: string }
  | { code: "future_service_date"; message: string }
  | { code: "stale_service_date"; message: string };

export function milesFromOdometer(start: unknown, end: unknown): number | null {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const miles = b - a;
  return Number.isFinite(miles) ? miles : null;
}

export function claimSanityIssues(rec: SanityCandidate, now = new Date()): SanityIssue[] {
  const issues: SanityIssue[] = [];

  const miles = rec.billed_miles;
  if (miles != null && Number.isFinite(Number(miles))) {
    const m = Number(miles);
    if (m <= 0 || m > MAX_CLAIM_MILES)
      issues.push({
        code: "miles_out_of_range",
        message: `Billed mileage of ${m} is outside the allowed 1–${MAX_CLAIM_MILES} mile range — check the odometer readings.`,
      });
  }

  if (rec.service_date != null && rec.service_date !== "") {
    const d = rec.service_date instanceof Date ? rec.service_date : new Date(rec.service_date);
    if (Number.isNaN(d.getTime())) {
      issues.push({ code: "invalid_service_date", message: "The service date is not a real date." });
    } else {
      const ageDays = (now.getTime() - d.getTime()) / 86_400_000;
      if (ageDays < -1)
        issues.push({
          code: "future_service_date",
          message: "The service date is in the future — it can't be billed yet.",
        });
      else if (ageDays > MAX_SERVICE_AGE_DAYS)
        issues.push({
          code: "stale_service_date",
          message: `The service date is more than ${MAX_SERVICE_AGE_DAYS} days old — confirm it before billing.`,
        });
    }
  }

  return issues;
}

/** True when the claim is safe for automatic submission. */
export function isClaimSane(rec: SanityCandidate, now = new Date()): boolean {
  return claimSanityIssues(rec, now).length === 0;
}

/** One short line for the Needs Attention list. */
export function sanityReason(rec: SanityCandidate, now = new Date()): string | null {
  return claimSanityIssues(rec, now)[0]?.message ?? null;
}
