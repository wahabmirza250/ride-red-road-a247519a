import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export type RouteStep = {
  instruction: string;
  maneuver: string | null;
  distanceMeters: number;
  end: { lat: number; lng: number };
};

export type ComputedRoute = {
  polyline: string;
  distanceText: string;
  durationText: string;
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
} | null;

/**
 * Computes a driving route via the Google Routes API (through the Lovable
 * connector gateway). Returns the geometry, ETA and the ordered turn-by-turn
 * steps so the driver app can render real in-app navigation guidance without
 * handing off to an external maps app.
 */
export const computeDriveRoute = createServerFn({ method: "POST" })
  .inputValidator((input: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }) => input)
  .handler(async ({ data }): Promise<ComputedRoute> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
    const directKey = process.env.GOOGLE_API_KEY;
    const useGateway = Boolean(lovableKey && gmapsKey);
    // Falls back to a direct Routes API call when the Maps connector isn't
    // linked in this workspace. If that key is referrer-restricted the call
    // fails and the driver app uses its browser-side directions fallback.
    if (!useGateway && !directKey) return null;

    const url = useGateway
      ? `${GATEWAY_URL}/routes/directions/v2:computeRoutes`
      : `https://routes.googleapis.com/directions/v2:computeRoutes`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...(useGateway
          ? { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gmapsKey as string }
          : { "X-Goog-Api-Key": directKey as string }),
        "Content-Type": "application/json",
        "X-Goog-FieldMask": [
          "routes.duration",
          "routes.distanceMeters",
          "routes.polyline.encodedPolyline",
          "routes.legs.steps.navigationInstruction",
          "routes.legs.steps.distanceMeters",
          "routes.legs.steps.endLocation",
        ].join(","),
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
        legs?: Array<{
          steps?: Array<{
            distanceMeters?: number;
            navigationInstruction?: { maneuver?: string; instructions?: string };
            endLocation?: { latLng?: { latitude?: number; longitude?: number } };
          }>;
        }>;
      }>;
    };
    const r = json.routes?.[0];
    if (!r?.polyline?.encodedPolyline) return null;

    const meters = r.distanceMeters ?? 0;
    const miles = meters / 1609.34;
    const seconds = Number(String(r.duration ?? "0s").replace("s", "")) || 0;
    const mins = Math.max(1, Math.round(seconds / 60));

    const steps: RouteStep[] = [];
    for (const leg of r.legs ?? []) {
      for (const s of leg.steps ?? []) {
        const lat = s.endLocation?.latLng?.latitude;
        const lng = s.endLocation?.latLng?.longitude;
        if (lat == null || lng == null) continue;
        steps.push({
          instruction: s.navigationInstruction?.instructions ?? "Continue",
          maneuver: s.navigationInstruction?.maneuver ?? null,
          distanceMeters: s.distanceMeters ?? 0,
          end: { lat, lng },
        });
      }
    }

    return {
      polyline: r.polyline.encodedPolyline,
      distanceText: miles < 0.2 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(1)} mi`,
      durationText: mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`,
      distanceMeters: meters,
      durationSeconds: seconds,
      steps,
    };
  });
