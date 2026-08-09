/// <reference types="google.maps" />
import { loadGoogleMapsDark } from "./googleMapsDark";
import type { ComputedRoute, RouteStep } from "./mapsRoute.functions";

function stripHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, " · ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Browser-side turn-by-turn fallback.
 *
 * The server Routes API (via the connector gateway) is the primary source. If
 * the connector isn't linked, we ask the Maps JS Directions service instead —
 * that call carries the page referrer, so the referrer-restricted browser key
 * is accepted.
 */
export async function browserDriveRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<ComputedRoute> {
  const g = await loadGoogleMapsDark();
  const svc = new g.maps.DirectionsService();
  const res = await svc.route({
    origin: from,
    destination: to,
    travelMode: g.maps.TravelMode.DRIVING,
  });
  const route = res.routes?.[0];
  const leg = route?.legs?.[0];
  if (!route || !leg) return null;

  const steps: RouteStep[] = (leg.steps ?? []).map((s) => ({
    instruction: stripHtml(s.instructions ?? "Continue"),
    maneuver: (s as unknown as { maneuver?: string }).maneuver ?? null,
    distanceMeters: s.distance?.value ?? 0,
    end: { lat: s.end_location.lat(), lng: s.end_location.lng() },
  }));

  return {
    polyline: route.overview_polyline as unknown as string,
    distanceText: leg.distance?.text ?? "",
    durationText: leg.duration?.text ?? "",
    distanceMeters: leg.distance?.value ?? 0,
    durationSeconds: leg.duration?.value ?? 0,
    steps,
  };
}
