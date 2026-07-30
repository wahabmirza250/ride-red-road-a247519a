import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export type ComputedRoute = {
  polyline: string;
  distanceText: string;
  durationText: string;
} | null;

/**
 * Computes a driving route via the Google Routes API (through the Lovable
 * connector gateway). Used instead of the browser Directions service, which
 * the browser key is not authorized for.
 */
export const computeDriveRoute = createServerFn({ method: "POST" })
  .inputValidator((input: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }) => input)
  .handler(async ({ data }): Promise<ComputedRoute> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !gmapsKey) return null;

    const res = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmapsKey,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: data.from.lat, longitude: data.from.lng } } },
        destination: { location: { latLng: { latitude: data.to.lat, longitude: data.to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    });
    if (!res.ok) {
      console.error(`Routes API failed [${res.status}]: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as {
      routes?: Array<{
        distanceMeters?: number;
        duration?: string;
        polyline?: { encodedPolyline?: string };
      }>;
    };
    const r = json.routes?.[0];
    if (!r?.polyline?.encodedPolyline) return null;

    const miles = (r.distanceMeters ?? 0) / 1609.34;
    const seconds = Number(String(r.duration ?? "0s").replace("s", "")) || 0;
    const mins = Math.max(1, Math.round(seconds / 60));
    return {
      polyline: r.polyline.encodedPolyline,
      distanceText: miles < 0.2 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(1)} mi`,
      durationText: mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`,
    };
  });
