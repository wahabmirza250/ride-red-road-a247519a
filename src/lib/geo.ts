// Haversine distance in miles between two lat/lng points
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Given a GPS route (array of {lat,lng,ts}), find stops:
// consecutive points that stayed within `deltaDeg` for at least `minMs`.
export type GpsPoint = { lat: number; lng: number; ts: number };
export type Stop = { lat: number; lng: number; startTs: number; endTs: number; durationMs: number };

export function detectStops(
  route: GpsPoint[],
  deltaDeg = 0.001,
  minMs = 120_000,
): Stop[] {
  const stops: Stop[] = [];
  if (route.length < 2) return stops;
  let i = 0;
  while (i < route.length) {
    let j = i;
    while (
      j + 1 < route.length &&
      Math.abs(route[j + 1].lat - route[i].lat) < deltaDeg &&
      Math.abs(route[j + 1].lng - route[i].lng) < deltaDeg
    ) {
      j++;
    }
    const duration = route[j].ts - route[i].ts;
    if (j > i && duration >= minMs) {
      // centroid
      let sumLat = 0;
      let sumLng = 0;
      for (let k = i; k <= j; k++) {
        sumLat += route[k].lat;
        sumLng += route[k].lng;
      }
      stops.push({
        lat: sumLat / (j - i + 1),
        lng: sumLng / (j - i + 1),
        startTs: route[i].ts,
        endTs: route[j].ts,
        durationMs: duration,
      });
    }
    i = j + 1;
  }
  return stops;
}

// Miles from a full route by summing haversine between points
export function routeMiles(route: GpsPoint[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineMiles(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng);
  }
  return total;
}
