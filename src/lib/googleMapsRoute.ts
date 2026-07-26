export type MapsStop = { address: string; lat?: number | null; lng?: number | null };

function coordOrAddress(s: MapsStop) {
  if (s.lat != null && s.lng != null) return `${s.lat},${s.lng}`;
  return s.address;
}

/**
 * Standard Google Maps directions URL with ordered waypoints.
 * https://www.google.com/maps/dir/?api=1&origin=..&destination=..&waypoints=a|b|c
 * Google caps waypoints at 9 for the universal URL, so we keep the first 9
 * intermediate stops and always preserve the final destination.
 */
export function buildGoogleMapsRouteUrl(stops: MapsStop[]): string | null {
  const clean = stops.filter((s) => s && (s.address?.trim() || (s.lat != null && s.lng != null)));
  if (clean.length === 0) return null;
  if (clean.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      coordOrAddress(clean[0]),
    )}`;
  }

  const origin = clean[0];
  const destination = clean[clean.length - 1];
  const middle = clean.slice(1, -1).slice(0, 9);

  const params = new URLSearchParams({
    api: "1",
    origin: coordOrAddress(origin),
    destination: coordOrAddress(destination),
    travelmode: "driving",
  });
  if (middle.length) {
    params.set("waypoints", middle.map(coordOrAddress).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
