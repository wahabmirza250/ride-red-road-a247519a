/**
 * CORRECTED-CLAIM MILEAGE SANITY (pure, no I/O).
 *
 * Incident 2026-08-31: seven corrected resubmissions were rejected with
 * "Billed mileage of 13602 is outside the allowed 1–52 mile range". The bill
 * was fine. The GATE was wrong: it computed miles as
 * `final dropoff odometer − first pickup odometer`, i.e. the whole-day span
 * INCLUDING the deadhead gap between the outbound and the return leg. A real
 * 18 + 18 = 36 mile round trip therefore looked like 13,602 miles.
 *
 * Billed miles are, and have always been, the SUM of per-leg deltas. This
 * module applies the range rule to each corrected leg / service line on its
 * own and reports the exact leg that is wrong, never a whole-day span.
 */
import { MAX_CLAIM_MILES } from "@/lib/claimSanity";

export type CorrectedLeg = {
  leg_index?: number | null;
  pickup_odometer?: number | null;
  dropoff_odometer?: number | null;
};

export type CorrectedLine = {
  line_index?: number | null;
  miles?: number | null;
  procedure_code?: string | null;
};

export type CorrectedMileageIssue = {
  code: "leg_miles_out_of_range" | "line_miles_out_of_range" | "no_billable_miles";
  message: string;
  leg_index?: number;
  line_index?: number;
};

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Miles of ONE leg: dropoff − pickup. Never a cross-leg span. */
export function correctedLegMiles(leg: CorrectedLeg): number | null {
  const a = n(leg.pickup_odometer);
  const b = n(leg.dropoff_odometer);
  if (a == null || b == null) return null;
  return r1(b - a);
}

/** Total billed miles = sum of each leg's own delta. Gaps are never billed. */
export function correctedTotalMiles(legs: CorrectedLeg[] | null | undefined): number {
  return r1(
    (legs ?? []).reduce((sum, l) => {
      const m = correctedLegMiles(l);
      return sum + (m != null && m > 0 ? m : 0);
    }, 0),
  );
}

/**
 * Range rule, applied per leg and per service line. Only a leg/line that truly
 * violates it is flagged, and the message names it.
 */
export function correctedMileageIssues(args: {
  legs?: CorrectedLeg[] | null;
  lines?: CorrectedLine[] | null;
}): CorrectedMileageIssue[] {
  const issues: CorrectedMileageIssue[] = [];
  const legs = args.legs ?? [];

  legs.forEach((leg, i) => {
    const idx = Number(leg.leg_index ?? i + 1);
    const miles = correctedLegMiles(leg);
    if (miles == null) return; // an empty leg is a completeness problem, not a range one
    if (miles <= 0)
      issues.push({
        code: "leg_miles_out_of_range",
        leg_index: idx,
        message:
          `Leg ${idx} has no billable miles (odometer ${leg.pickup_odometer} → ${leg.dropoff_odometer}). ` +
          "Check that leg's two odometer readings.",
      });
    else if (miles > MAX_CLAIM_MILES)
      issues.push({
        code: "leg_miles_out_of_range",
        leg_index: idx,
        message:
          `Leg ${idx} is ${miles} miles (odometer ${leg.pickup_odometer} → ${leg.dropoff_odometer}), ` +
          `outside the allowed 1–${MAX_CLAIM_MILES} miles for a single leg. Check that leg's odometer readings.`,
      });
  });

  (args.lines ?? []).forEach((line, i) => {
    const idx = Number(line.line_index ?? i + 1);
    const miles = n(line.miles);
    if (miles == null || miles === 0) return; // trip-charge lines carry no miles
    if (miles < 0 || miles > MAX_CLAIM_MILES * Math.max(1, legs.length))
      issues.push({
        code: "line_miles_out_of_range",
        line_index: idx,
        message:
          `Service line ${idx} bills ${miles} miles, which is outside the allowed range for ` +
          `${Math.max(1, legs.length)} leg(s). Correct that line before sending.`,
      });
  });

  if (legs.length > 0 && correctedTotalMiles(legs) <= 0)
    issues.push({
      code: "no_billable_miles",
      message: "The corrected odometer readings add up to 0 billable miles.",
    });

  return issues;
}
