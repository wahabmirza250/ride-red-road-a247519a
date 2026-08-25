/**
 * Same member + same date-of-service detection.
 *
 * This is a REVIEW WARNING ONLY. It never merges claims, never changes a
 * payload and never adds a modifier — the biller decides what is correct.
 */

export type SameDayTrip = {
  trip_id: string;
  company_id: string | null;
  medicaid_id: string | null;
  member_name?: string | null;
  service_date: string | null; // ISO date or datetime
};

export type SameDayGroup = {
  key: string;
  company_id: string | null;
  medicaid_id: string;
  member_name: string | null;
  service_date: string;
  trip_ids: string[];
};

export const dayOf = (v: string | null | undefined) =>
  v ? String(v).slice(0, 10) : "";

const keyOf = (t: SameDayTrip) =>
  `${t.company_id ?? "none"}|${(t.medicaid_id ?? "").trim().toUpperCase()}|${dayOf(t.service_date)}`;

/** Groups with MORE THAN ONE trip for the same company + member + service date. */
export function findSameDayGroups(trips: SameDayTrip[]): SameDayGroup[] {
  const buckets = new Map<string, SameDayTrip[]>();
  for (const t of trips) {
    if (!t.medicaid_id?.trim() || !dayOf(t.service_date)) continue;
    const k = keyOf(t);
    buckets.set(k, [...(buckets.get(k) ?? []), t]);
  }
  const out: SameDayGroup[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    out.push({
      key,
      company_id: list[0]!.company_id ?? null,
      medicaid_id: (list[0]!.medicaid_id ?? "").trim().toUpperCase(),
      member_name: list[0]!.member_name ?? null,
      service_date: dayOf(list[0]!.service_date),
      trip_ids: list.map((t) => t.trip_id),
    });
  }
  return out;
}

export const SAME_DAY_WARNING =
  "Multiple trips found for this member on this service date. Review before submitting — no modifier has been applied.";

/** Trip ids that should show the warning badge. */
export function sameDayFlaggedTripIds(trips: SameDayTrip[]): Set<string> {
  const s = new Set<string>();
  for (const g of findSameDayGroups(trips)) for (const id of g.trip_ids) s.add(id);
  return s;
}
