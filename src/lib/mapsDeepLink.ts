// Opens Google Maps in a real external browser tab / native app.
//
// The tricky part: when the driver app is served with strict cross-origin
// isolation headers (COOP: same-origin, COEP: require-corp — required for
// the preview iframe / PWA), any popup we spawn *inherits* those headers.
// google.com/maps refuses to render inside a COEP-isolated context, which
// surfaces as `ERR_BLOCKED_BY_RESPONSE — www.google.com is blocked` in a
// brand new tab even though the URL is correct.
//
// Fix: open a blank tab first (which lives under our origin's policies),
// then have that tab perform a top-level navigation to Google Maps via
// `window.location.replace`. The navigation crosses origins to google.com
// and the isolated context is dropped, so Maps loads normally.
//
// On iOS/Android, the same https link triggers the installed Google Maps /
// Apple Maps app via universal links, so we don't need custom `geo:` or
// `comgooglemaps://` schemes.
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

  // Primary path: open a blank tab synchronously (needs the user gesture),
  // then navigate it. Do NOT use `noopener` here — that forces the new tab
  // to inherit our COOP/COEP isolation, which is exactly what blocks Maps.
  // We manually detach `opener` right before the cross-origin navigation.
  const win = window.open("about:blank", "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      /* ignore */
    }
    try {
      win.location.replace(httpsUrl);
      return;
    } catch {
      /* fall through to anchor fallback */
    }
  }

  // Fallback for browsers/webviews that block programmatic window.open:
  // synthesize a user-style anchor click with target=_blank so the host
  // browser handles it as an external navigation.
  const a = document.createElement("a");
  a.href = httpsUrl;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

