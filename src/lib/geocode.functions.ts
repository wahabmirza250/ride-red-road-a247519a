import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const InputSchema = z.object({
  address: z.string().trim().min(3).max(300),
});

export type GeocodeResult = {
  address: string;
  lat: number;
  lng: number;
};

async function callGoogleGeocode(qs: string): Promise<GeocodeResult | null> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const directKey = process.env.GOOGLE_API_KEY;

  let res: Response;
  if (lovableKey && gmapsKey) {
    res = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?${qs}`, {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmapsKey,
      },
    });
  } else if (directKey) {
    res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${qs}&key=${directKey}`);
  } else {
    throw new Error("Google Maps is not configured");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Geocoding failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as {
    status: string;
    results?: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (json.status !== "OK" || !json.results?.length) return null;
  const first = json.results[0];
  return {
    address: first.formatted_address,
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
  };
}

/** Forward-geocode a typed address into coordinates. */
export const geocodeAddress = createServerFn({ method: "POST" })
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }) => callGoogleGeocode(`address=${encodeURIComponent(data.address)}`));

const ReverseInputSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

/** Reverse-geocode lat/lng into a street address. */
export const reverseGeocode = createServerFn({ method: "POST" })
  .inputValidator((data) => ReverseInputSchema.parse(data))
  .handler(async ({ data }) => callGoogleGeocode(`latlng=${data.lat},${data.lng}`));
