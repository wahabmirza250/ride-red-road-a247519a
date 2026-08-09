import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string;
};

export type PlaceDetails = {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * Returns the auth headers for Places calls. Prefers the Lovable connector
 * gateway; falls back to a direct Google API key (GOOGLE_API_KEY) so the
 * app keeps working when the connector isn't linked in this workspace.
 */
function placesRequest(path: string, init: RequestInit & { headers?: Record<string, string> }) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const directKey = process.env.GOOGLE_API_KEY;
  const headers = { ...(init.headers ?? {}) };

  if (lovableKey && gmapsKey) {
    return fetch(`${GATEWAY_URL}${path}`, {
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
  throw new Error("Google Maps is not configured");
}

/**
 * Server-side Places autocomplete via the gateway. Works on any domain
 * (custom domains, localhost) because the connector server key is not
 * referrer-restricted like the browser key.
 */
export const autocompletePlaces = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        input: z.string().trim().min(2).max(200),
        sessionToken: z.string().trim().min(1).max(200).optional(),
        // Optional location bias (user's current position) to prioritize nearby results.
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        // ISO 3166-1 alpha-2 country code(s) to restrict results (e.g. "us").
        regionCode: z.string().trim().length(2).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => {
    const { lovableKey, gmapsKey } = creds();
    const body: Record<string, unknown> = {
      input: data.input,
      sessionToken: data.sessionToken,
      // Default to US so a partial query like "12" doesn't return Iran/global results.
      includedRegionCodes: [data.regionCode?.toLowerCase() ?? "us"],
      languageCode: "en",
    };
    if (data.lat != null && data.lng != null) {
      body.locationBias = {
        circle: {
          center: { latitude: data.lat, longitude: data.lng },
          radius: 50000, // 50km bias around the user
        },
      };
    }
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmapsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Places autocomplete failed [${res.status}]: ${text}`);
    }
    const json = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId: string;
          structuredFormat?: {
            mainText?: { text: string };
            secondaryText?: { text: string };
          };
          text?: { text: string };
        };
      }>;
    };
    return (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }))
      .filter((s) => s.primary);
  });


/**
 * Resolve a Google place_id to a formatted address + lat/lng via the gateway.
 */
export const getPlaceDetails = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        placeId: z.string().trim().min(1).max(200),
        sessionToken: z.string().trim().min(1).max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<PlaceDetails | null> => {
    const { lovableKey, gmapsKey } = creds();
    const params = new URLSearchParams();
    if (data.sessionToken) params.set("sessionToken", data.sessionToken);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${GATEWAY_URL}/places/v1/places/${encodeURIComponent(data.placeId)}${qs}`, {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmapsKey,
        "X-Goog-FieldMask": "id,formattedAddress,location",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Place details failed [${res.status}]: ${body}`);
    }
    const json = (await res.json()) as {
      id?: string;
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
    };
    if (!json.location || !json.formattedAddress) return null;
    return {
      placeId: json.id ?? data.placeId,
      address: json.formattedAddress,
      lat: json.location.latitude,
      lng: json.location.longitude,
    };
  });
