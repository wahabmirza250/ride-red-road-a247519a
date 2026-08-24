/**
 * SERVER-ONLY place lookups used by the medical-destination review layer.
 *
 * Reuses the exact same Google credentials strategy as `places.functions.ts`
 * (Lovable connector gateway first, direct GOOGLE_API_KEY fallback) so no
 * second/conflicting Maps integration is introduced. Every failure is soft:
 * callers get `ok: false` and the classifier marks the destination `unknown`
 * instead of flagging a valid medical trip.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export type LookupPlace = {
  name?: string | null;
  types?: string[] | null;
  address?: string | null;
};

export type LookupResult = {
  ok: boolean;
  provider: "google_places" | "none";
  place: LookupPlace | null;
  /** Other businesses that resolve to the same street address (mixed-use). */
  nearby: LookupPlace[];
  error?: string;
};

const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.types,places.primaryType";

function placesFetch(path: string, init: RequestInit & { headers?: Record<string, string> }) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const gmapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  const directKey = process.env["GOOGLE_API_KEY"];
  const headers = { ...(init.headers ?? {}) };

  if (lovableKey && gmapsKey) {
    return fetch(`${GATEWAY_URL}/places${path}`, {
      ...init,
      headers: {
        ...headers,
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmapsKey,
      },
    });
  }
  if (directKey) {
    return fetch(`https://places.googleapis.com${path}`, {
      ...init,
      headers: { ...headers, "X-Goog-Api-Key": directKey },
    });
  }
  throw new Error("Google Places is not configured");
}

/** True when at least one credential path is available. */
export function placesConfigured(): boolean {
  return Boolean(
    (process.env["LOVABLE_API_KEY"] && process.env["GOOGLE_MAPS_API_KEY"]) ||
      process.env["GOOGLE_API_KEY"],
  );
}

function mapPlaces(json: any): LookupPlace[] {
  return (json?.places ?? []).map((p: any) => ({
    name: p?.displayName?.text ?? null,
    types: [
      ...(Array.isArray(p?.types) ? p.types : []),
      ...(p?.primaryType ? [p.primaryType] : []),
    ],
    address: p?.formattedAddress ?? null,
  }));
}

function streetNumber(addr: string): string | null {
  const m = /^\s*(\d+)/.exec(addr);
  return m ? m[1]! : null;
}

/**
 * One text search per destination. The first result is treated as the
 * destination itself; the remaining results that share the same street number
 * form the mixed-use "same building" evidence set.
 */
export async function lookupDestination(address: string): Promise<LookupResult> {
  const query = address.trim();
  if (query.length < 4) {
    return { ok: false, provider: "none", place: null, nearby: [], error: "address too short" };
  }
  if (!placesConfigured()) {
    return { ok: false, provider: "none", place: null, nearby: [], error: "places not configured" };
  }
  try {
    const res = await placesFetch("/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({ textQuery: query, languageCode: "en", maxResultCount: 10 }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        provider: "google_places",
        place: null,
        nearby: [],
        error: `searchText ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = await res.json();
    const places = mapPlaces(json);
    if (!places.length) {
      return { ok: true, provider: "google_places", place: null, nearby: [] };
    }
    const primary = places[0]!;
    const num = streetNumber(primary.address ?? query);
    const nearby = places.slice(1).filter((p) => {
      if (!num || !p.address) return false;
      return streetNumber(p.address) === num;
    });
    return { ok: true, provider: "google_places", place: primary, nearby };
  } catch (e: any) {
    return {
      ok: false,
      provider: "google_places",
      place: null,
      nearby: [],
      error: String(e?.message ?? e).slice(0, 200),
    };
  }
}

/** Small concurrency limiter so a bulk classification never floods Places. */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
