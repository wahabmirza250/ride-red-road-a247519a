/**
 * SERVER-SIDE runner for the medical-destination review layer.
 *
 * Additive only: it writes to `trip_destination_classifications`,
 * `destination_place_cache` and `destination_review_overrides`. It never
 * touches trip/claim fields, never changes a billing status, and never talks
 * to HCPF or the submission robot.
 */
import {
  CLASSIFIER_VERSION,
  classifyDestination,
  normalizeDestinationKey,
  type ClassifierResult,
  type PlaceEvidence,
} from "@/lib/destinationClassifier";
import { lookupDestination, mapLimited, placesConfigured } from "@/lib/placesLookup.server";

/** Hard ceiling on external Places calls per run (rate-limit safety). */
export const MAX_LOOKUPS_PER_RUN = 60;
/** Parallel Places calls. */
export const LOOKUP_CONCURRENCY = 4;
/** Rows classified per bulk run. */
export const MAX_TRIPS_PER_RUN = 500;

export type TripDestination = {
  trip_id: string;
  company_id?: string | null;
  destination: string | null;
  /** Optional business name captured on the paper form. */
  destination_name?: string | null;
};

export type CacheRow = {
  normalized_key: string;
  address?: string | null;
  place?: PlaceEvidence | null;
  nearby?: PlaceEvidence[] | null;
  lookup_ok?: boolean | null;
  expires_at?: string | null;
};

/**
 * Decide which normalized destination keys still need an external lookup.
 * Cached-and-fresh keys are reused; failed lookups are retried only after
 * their TTL expires, so a provider outage can't cause a call storm.
 */
export function selectLookupTargets(
  keys: string[],
  cache: Map<string, CacheRow>,
  now: Date = new Date(),
  max: number = MAX_LOOKUPS_PER_RUN,
): { fetch: string[]; deferred: string[] } {
  const misses: string[] = [];
  for (const key of Array.from(new Set(keys.filter(Boolean)))) {
    const row = cache.get(key);
    const fresh = row?.expires_at ? new Date(row.expires_at).getTime() > now.getTime() : false;
    if (row && fresh) continue;
    misses.push(key);
  }
  return { fetch: misses.slice(0, max), deferred: misses.slice(max) };
}

/** Classify one trip against whatever evidence we have for its destination. */
export function classifyTripDestination(
  trip: TripDestination,
  cache: Map<string, CacheRow>,
  deferredKeys: Set<string> = new Set(),
): ClassifierResult {
  const key = normalizeDestinationKey(trip.destination);
  const row = cache.get(key);
  const providerFailed = deferredKeys.has(key) || (!!row && row.lookup_ok === false) || (!row && key.length > 0 && !cache.size);
  return classifyDestination({
    address: trip.destination,
    name: trip.destination_name ?? null,
    place: row?.place ?? null,
    nearby: row?.nearby ?? [],
    providerFailed: !row ? providerFailed : row.lookup_ok === false,
  });
}

/** Build the rows to upsert into `trip_destination_classifications`. */
export function buildClassificationRows(
  trips: TripDestination[],
  cache: Map<string, CacheRow>,
  deferredKeys: Set<string> = new Set(),
) {
  return trips.map((t) => {
    const res = classifyTripDestination(t, cache, deferredKeys);
    const key = normalizeDestinationKey(t.destination);
    const row = cache.get(key);
    return {
      trip_id: t.trip_id,
      company_id: t.company_id ?? null,
      destination_text: t.destination ?? null,
      status: res.status,
      confidence: res.confidence,
      summary: res.summary,
      reasons: res.reasons,
      matched: res.matched,
      evidence: {
        normalized_key: key,
        place: row?.place ?? null,
        nearby: row?.nearby ?? [],
        place_lookup: row ? (row.lookup_ok === false ? "failed" : "ok") : "missing",
        destination_name: t.destination_name ?? null,
      },
      classifier_version: CLASSIFIER_VERSION,
      classified_at: new Date().toISOString(),
    };
  });
}

async function loadCache(supabase: any, keys: string[]): Promise<Map<string, CacheRow>> {
  const map = new Map<string, CacheRow>();
  const unique = Array.from(new Set(keys.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data } = await supabase
      .from("destination_place_cache")
      .select("normalized_key, address, place, nearby, lookup_ok, expires_at")
      .in("normalized_key", chunk);
    for (const row of data ?? []) map.set(row.normalized_key, row as CacheRow);
  }
  return map;
}

/**
 * Classify a batch of trip destinations: read cache → fetch only the misses
 * (rate-limited) → persist cache → upsert classifications.
 * Returns per-status counts plus how many lookups were deferred.
 */
export async function runClassification(
  supabase: any,
  trips: TripDestination[],
  opts: { refreshKeys?: string[] } = {},
) {
  const batch = trips.slice(0, MAX_TRIPS_PER_RUN);
  const keys = batch.map((t) => normalizeDestinationKey(t.destination)).filter(Boolean);
  const cache = await loadCache(supabase, keys);

  // A manual recheck forces those keys to be re-fetched.
  for (const k of opts.refreshKeys ?? []) cache.delete(normalizeDestinationKey(k));

  const { fetch: toFetch, deferred } = selectLookupTargets(keys, cache);
  const keyToAddress = new Map<string, string>();
  for (const t of batch) {
    const k = normalizeDestinationKey(t.destination);
    if (k && !keyToAddress.has(k)) keyToAddress.set(k, String(t.destination ?? ""));
  }

  if (toFetch.length && placesConfigured()) {
    const results = await mapLimited(toFetch, LOOKUP_CONCURRENCY, async (key) =>
      ({ key, res: await lookupDestination(keyToAddress.get(key) ?? key) }),
    );
    const cacheRows = results.map(({ key, res }) => ({
      normalized_key: key,
      address: keyToAddress.get(key) ?? key,
      place: res.place,
      nearby: res.nearby,
      provider: res.provider,
      lookup_ok: res.ok,
      fetched_at: new Date().toISOString(),
      // Failed lookups get a short TTL so they retry soon; successes last 30 days.
      expires_at: new Date(
        Date.now() + (res.ok ? 30 * 24 * 3600_000 : 6 * 3600_000),
      ).toISOString(),
    }));
    if (cacheRows.length) {
      await supabase
        .from("destination_place_cache")
        .upsert(cacheRows, { onConflict: "company_id,normalized_key" });
      for (const r of cacheRows) cache.set(r.normalized_key, r as CacheRow);
    }
  } else if (toFetch.length) {
    // No Places credentials: fall back to text-only evidence, never a flag storm.
    for (const key of toFetch) {
      cache.set(key, {
        normalized_key: key,
        address: keyToAddress.get(key) ?? key,
        place: null,
        nearby: [],
        lookup_ok: false,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    }
  }

  const rows = buildClassificationRows(batch, cache, new Set(deferred));
  if (rows.length) {
    const { error } = await supabase
      .from("trip_destination_classifications")
      .upsert(rows, { onConflict: "trip_id,classifier_version" });
    if (error) throw new Error(error.message);
  }

  const counts: Record<string, number> = {
    medical_confident: 0,
    medical_possible: 0,
    review_non_medical: 0,
    unknown: 0,
  };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    classified: rows.length,
    lookups: toFetch.length,
    deferred_lookups: deferred.length,
    places_configured: placesConfigured(),
    counts,
    version: CLASSIFIER_VERSION,
  };
}

/** Audit row for a deliberate "send anyway to billing" override. */
export function buildOverrideRow(input: {
  trip_id: string;
  billing_record_id: string | null;
  company_id: string | null;
  classification: { id?: string | null; status: string; summary?: string | null } | null;
  note?: string | null;
  actor_id: string | null;
}) {
  return {
    trip_id: input.trip_id,
    billing_record_id: input.billing_record_id,
    company_id: input.company_id,
    classification_id: input.classification?.id ?? null,
    original_status: input.classification?.status ?? "unknown",
    original_summary: input.classification?.summary ?? null,
    note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
    overridden_by: input.actor_id,
  };
}
