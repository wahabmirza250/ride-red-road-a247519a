const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

/**
 * Best-effort forward geocode used when a driver types an address by hand.
 * Returns null (never throws) so an address correction is still saved when
 * the geocoding service is unavailable.
 */
export async function geocodeForTrip(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!lovableKey || !gmapsKey || address.length < 3) return null;
  try {
    const res = await fetch(
      `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(address)}`,
      {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": gmapsKey,
        },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status: string;
      results?: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };
    if (json.status !== "OK" || !json.results?.length) return null;
    const loc = json.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}
