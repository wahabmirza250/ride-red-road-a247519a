export type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const c =
    s1 * s1 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      s2 *
      s2;
  return 2 * R * Math.asin(Math.sqrt(c));
}

export type Pricing = { base_fare: number; per_km: number; per_minute: number; currency: string };

export function estimateFare(distanceKm: number, pricing: Pricing, avgKmh = 40) {
  const minutes = (distanceKm / avgKmh) * 60;
  const fare = pricing.base_fare + distanceKm * pricing.per_km + minutes * pricing.per_minute;
  return {
    minutes: Math.max(1, Math.round(minutes)),
    fare: Math.max(pricing.base_fare, Math.round(fare * 100) / 100),
    currency: pricing.currency,
  };
}

export function fmtMoney(v: number | null | undefined, currency = "USD") {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}
