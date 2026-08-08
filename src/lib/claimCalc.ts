/**
 * Claim charge math — the single source of truth shared by the paper-bill
 * chat entry and the review UI. Mirrors exactly what the HCPF automation
 * computes at the portal:
 *
 *   Trip charge     = units (1 one-way, 2 round trip) × trip rate
 *   Mileage charge  = total miles × mile rate
 *
 * Pure functions only — safe to import from client and server.
 */

export type RateRow = {
  vehicle_type: string;
  unit_type: string;
  procedure_code: string;
  charge_amount: number | string;
  place_of_service?: string | null;
  default_diagnosis_code?: string | null;
};

export type OdometerLeg = {
  pickup_odometer: number;
  dropoff_odometer: number;
};

export type ChargeLine = {
  label: string;
  procedure_code: string | null;
  units: number;
  rate: number;
  amount: number;
  unit_word: string;
};

export type ClaimCalc = {
  trip_kind: "one_way" | "round_trip";
  units: number;
  miles: number;
  lines: ChargeLine[];
  total: number;
  diagnosis_code: string | null;
  missing_rates: string[];
};

export function legMiles(leg: OdometerLeg): number {
  const m = Number(leg.dropoff_odometer) - Number(leg.pickup_odometer);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 10) / 10 : 0;
}

export function findRate(
  rates: RateRow[],
  vehicleType: string,
  unitType: "trip" | "mile",
): RateRow | null {
  return (
    rates.find((r) => r.vehicle_type === vehicleType && r.unit_type === unitType) ?? null
  );
}

/** Round trip when BOTH leg-2 odometer readings are real numbers. */
export function resolveTripKind(legs: OdometerLeg[]): "one_way" | "round_trip" {
  return legs.length >= 2 ? "round_trip" : "one_way";
}

export function calcClaim(args: {
  legs: OdometerLeg[];
  rates: RateRow[];
  vehicleType: string;
}): ClaimCalc {
  const { legs, rates, vehicleType } = args;
  const trip_kind = resolveTripKind(legs);
  const units = trip_kind === "round_trip" ? 2 : 1;
  const miles = Math.round(legs.reduce((sum, l) => sum + legMiles(l), 0) * 10) / 10;

  const tripRate = findRate(rates, vehicleType, "trip");
  const mileRate = findRate(rates, vehicleType, "mile");
  const missing_rates: string[] = [];
  if (!tripRate) missing_rates.push("trip");
  if (!mileRate) missing_rates.push("mile");

  const lines: ChargeLine[] = [];
  if (tripRate) {
    const rate = Number(tripRate.charge_amount);
    lines.push({
      label: "Trip charge",
      procedure_code: tripRate.procedure_code,
      units,
      rate,
      amount: round2(units * rate),
      unit_word: units === 1 ? "unit (one way)" : "units (round trip)",
    });
  }
  if (mileRate) {
    const rate = Number(mileRate.charge_amount);
    lines.push({
      label: "Mileage charge",
      procedure_code: mileRate.procedure_code,
      units: miles,
      rate,
      amount: round2(miles * rate),
      unit_word: "miles",
    });
  }

  return {
    trip_kind,
    units,
    miles,
    lines,
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    diagnosis_code:
      tripRate?.default_diagnosis_code ?? mileRate?.default_diagnosis_code ?? null,
    missing_rates,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
