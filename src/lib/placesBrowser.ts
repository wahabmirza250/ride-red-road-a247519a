/// <reference types="google.maps" />
// Browser-side Places/Geocoding fallbacks.
// Used when the server-side connector gateway isn't available: the project's
// Google key is referrer-restricted, so it works from the browser on the
// app's own domains even when server-to-server calls are blocked.

import { loadGoogleMaps } from "./googleMapsLoader";

export type BrowserSuggestion = {
  placeId: string;
  primary: string;
  secondary: string;
};

export type BrowserPlace = {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
};

export async function browserAutocomplete(
  input: string,
  opts: { lat?: number; lng?: number; regionCode?: string } = {},
): Promise<BrowserSuggestion[]> {
  const g = await loadGoogleMaps();
  const { AutocompleteSuggestion } = (await g.maps.importLibrary(
    "places",
  )) as google.maps.PlacesLibrary;

  const request: google.maps.places.AutocompleteRequest = {
    input,
    includedRegionCodes: [(opts.regionCode ?? "us").toLowerCase()],
    language: "en",
  };
  if (opts.lat != null && opts.lng != null) {
    request.locationBias = new g.maps.Circle({
      center: { lat: opts.lat, lng: opts.lng },
      radius: 50000,
    });
  }

  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
  return (suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      placeId: p.placeId,
      primary: p.mainText?.text ?? p.text?.text ?? "",
      secondary: p.secondaryText?.text ?? "",
    }))
    .filter((s) => s.primary);
}

export async function browserPlaceDetails(placeId: string): Promise<BrowserPlace | null> {
  const g = await loadGoogleMaps();
  const { Place } = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  const place = new Place({ id: placeId });
  await place.fetchFields({ fields: ["formattedAddress", "location", "id"] });
  const loc = place.location;
  if (!loc || !place.formattedAddress) return null;
  return {
    placeId: place.id ?? placeId,
    address: place.formattedAddress,
    lat: typeof loc.lat === "function" ? loc.lat() : (loc as unknown as { lat: number }).lat,
    lng: typeof loc.lng === "function" ? loc.lng() : (loc as unknown as { lng: number }).lng,
  };
}

export async function browserGeocode(
  address: string,
): Promise<{ address: string; lat: number; lng: number } | null> {
  const g = await loadGoogleMaps();
  const geocoder = new g.maps.Geocoder();
  const { results } = await geocoder.geocode({ address });
  const first = results?.[0];
  if (!first) return null;
  return {
    address: first.formatted_address,
    lat: first.geometry.location.lat(),
    lng: first.geometry.location.lng(),
  };
}
