import { calcClaim, type RateRow } from "@/lib/claimCalc";

export type ClaimTotal = {
  amount: number | null;
  source: "captured" | "calculated" | null;
};

function parseCaptured(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Single source of truth for "what is this submitted claim worth".
 *
 * Preference order:
 *  1. The robot's captured claim total (Pass-1 capture reads it off the portal).
 *  2. A recalculation from the company's own billing rates + the trip's
 *     odometer legs — identical math to what the portal was filled with.
 *
 * One-shot ("full" mode) submissions never return captured data, so #2 is the
 * normal path for real submitted claims.
 *
 * `trips` rows must include: id, company_id, vehicle_type, robot_captured_claim,
 * odometer_start, odometer_end and (ideally) medicaid_trip_legs.
 */
export async function computeClaimTotals(
  supabase: any,
  trips: any[],
): Promise<Map<string, ClaimTotal>> {
  const out = new Map<string, ClaimTotal>();
  if (!trips.length) return out;

  const needCalc = trips.filter(
    (t) => parseCaptured(t?.robot_captured_claim?.total_charged_amount) == null,
  );

  // Rates for every company involved, in one query.
  const companyIds = Array.from(
    new Set(needCalc.map((t) => t.company_id).filter(Boolean)),
  ) as string[];
  const ratesByCompany = new Map<string, RateRow[]>();
  if (companyIds.length) {
    const { data } = await supabase
      .from("billing_rate_settings")
      .select(
        "company_id, vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code",
      )
      .in("company_id", companyIds);
    for (const r of (data ?? []) as any[]) {
      const list = ratesByCompany.get(r.company_id) ?? [];
      list.push(r as RateRow);
      ratesByCompany.set(r.company_id, list);
    }
  }

  // Odometer legs for trips that didn't ship them inline.
  const legsByTrip = new Map<string, any[]>();
  const missingLegs = needCalc
    .filter((t) => !Array.isArray(t.medicaid_trip_legs))
    .map((t) => t.id as string);
  for (const t of needCalc) {
    if (Array.isArray(t.medicaid_trip_legs)) legsByTrip.set(t.id, t.medicaid_trip_legs);
  }
  if (missingLegs.length) {
    const { selectIn } = await import("@/lib/dbChunk");
    const data = await selectIn<any>(
      supabase,
      "medicaid_trip_legs",
      "medicaid_trip_id, leg_index, pickup_odometer, dropoff_odometer",
      "medicaid_trip_id",
      missingLegs,
    );
    for (const l of data) {
      const list = legsByTrip.get(l.medicaid_trip_id) ?? [];
      list.push(l);
      legsByTrip.set(l.medicaid_trip_id, list);
    }
  }

  for (const t of trips) {
    const captured = parseCaptured(t?.robot_captured_claim?.total_charged_amount);
    if (captured != null) {
      out.set(t.id, { amount: captured, source: "captured" });
      continue;
    }

    const rates = ratesByCompany.get(t.company_id) ?? [];
    const rawLegs = (legsByTrip.get(t.id) ?? []).slice().sort(
      (a: any, b: any) => Number(a.leg_index) - Number(b.leg_index),
    );
    const legs = rawLegs.length
      ? rawLegs.map((l: any) => ({
          pickup_odometer: Number(l.pickup_odometer ?? 0),
          dropoff_odometer: Number(l.dropoff_odometer ?? 0),
        }))
      : [
          {
            pickup_odometer: Number(t.odometer_start ?? 0),
            dropoff_odometer: Number(t.odometer_end ?? 0),
          },
        ];

    const vehicleType = String(t.vehicle_type ?? "ambulatory");
    const calc = calcClaim({ legs, rates, vehicleType });
    out.set(
      t.id,
      calc.total > 0 ? { amount: calc.total, source: "calculated" } : { amount: null, source: null },
    );
  }

  return out;
}
