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

function creds() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!lovableKey || !gmapsKey) throw new Error("Google Maps connector is not configured");
  return { lovableKey, gmapsKey };
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
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => {
    const { lovableKey, gmapsKey } = creds();
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmapsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: data.input,
        sessionToken: data.sessionToken,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Places autocomplete failed [${res.status}]: ${body}`);
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
