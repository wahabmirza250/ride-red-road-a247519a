// Opens the native Google Maps app when possible, otherwise a browser fallback.
// Works from Android Chrome (google.navigation intent), iOS Safari (comgooglemaps/maps://),
// and desktop browsers (universal https link).
export function openNavigation(dest: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}) {
  const lat = Number(dest.lat);
  const lng = Number(dest.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const destParam = hasCoords ? `${lat},${lng}` : dest.address ?? "";
  const httpsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destParam,
  )}&travelmode=driving`;

  if (typeof window === "undefined") return;

  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid && hasCoords) {
    // Native Google Maps navigation intent
    window.location.href = `google.navigation:q=${lat},${lng}&mode=d`;
    // Fallback: after a brief pause open https version
    setTimeout(() => window.open(httpsUrl, "_blank"), 600);
    return;
  }
  if (isIOS) {
    // Try Google Maps app, then Apple Maps
    const gm = `comgooglemaps://?daddr=${encodeURIComponent(destParam)}&directionsmode=driving`;
    window.location.href = gm;
    setTimeout(() => window.open(httpsUrl, "_blank"), 600);
    return;
  }
  const w = window.open(httpsUrl, "_blank");
  if (w) w.opener = null;
}
