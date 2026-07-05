// Opens Google Maps in a real external browser tab.
//
// Why not `window.location.href = "google.navigation:..."` or an https URL?
// The driver app can run inside an embedded webview (PWA, in-app browser,
// preview iframe). Navigating the current frame to google.com/maps triggers
// Google's X-Frame-Options / frame-ancestors block ("ERR_BLOCKED_BY_RESPONSE
// — google.com is blocked"). Opening a new top-level tab bypasses that
// because the map loads in its own top-level browsing context.
export function openNavigation(dest: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}) {
  if (typeof window === "undefined") return;

  const lat = Number(dest.lat);
  const lng = Number(dest.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const destParam = hasCoords ? `${lat},${lng}` : dest.address ?? "";
  if (!destParam) return;

  const httpsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destParam,
  )}&travelmode=driving`;

  // Primary: real new top-level tab. Works in browser, PWA, iOS/Android
  // system browser, and popped out of embedded webviews.
  const opened = window.open(httpsUrl, "_blank", "noopener,noreferrer");
  if (opened) {
    try {
      (opened as Window).opener = null;
    } catch {
      /* ignore */
    }
    return;
  }

  // Fallback for browsers/webviews that block programmatic window.open:
  // synthesize a user-style anchor click with target=_blank so the host
  // browser handles it as an external navigation instead of replacing the
  // current (iframe/webview) location.
  const a = document.createElement("a");
  a.href = httpsUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
