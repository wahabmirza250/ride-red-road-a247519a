export type NavigationDestination = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
};

/** Builds the Google Maps universal directions URL used by every driver flow. */
export function googleMapsDirectionsUrl(dest: NavigationDestination): string | null {
  const lat = Number(dest.lat);
  const lng = Number(dest.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const address = dest.address?.trim() ?? "";
  const destination = hasCoords ? `${lat},${lng}` : address;
  if (!destination) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destination,
  )}&travelmode=driving&dir_action=navigate`;
}

/**
 * Opens Google Maps directly from the user's tap.
 *
 * A same-window universal-link navigation is intentional: iOS standalone
 * PWAs and embedded Android webviews often block or retain `window.open()`
 * popups. Assigning the top-level location synchronously is reliable, invokes
 * the installed Maps app when the OS supports it, and otherwise opens Google
 * Maps in the browser. The PWA remains in its previous state when the driver
 * returns.
 */
export function openNavigation(dest: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}) {
  if (typeof window === "undefined") return;
  const url = googleMapsDirectionsUrl(dest);
  if (!url) return;
  window.location.assign(url);
}

