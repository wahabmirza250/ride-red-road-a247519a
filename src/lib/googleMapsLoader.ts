/// <reference types="google.maps" />
// Loads the Google Maps JS API once, with Places lib, using loading=async.
// Safe to call from multiple components — subsequent calls return the same promise.

let loaderPromise: Promise<typeof google> | null = null;

declare global {
  interface Window {
    __lovableGmapsCb?: () => void;
    google?: typeof google;
  }
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loaderPromise) return loaderPromise;

  const managed = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const custom = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  const host = window.location.hostname;
  const isLovableHost = /\.lovable\.(app|dev)$/.test(host) || /\.lovableproject\.com$/.test(host);
  const key = isLovableHost ? (managed || custom) : (custom || managed);
  const useChannel = isLovableHost && channel;
  if (!key) return Promise.reject(new Error("Google Maps browser key missing"));

  loaderPromise = new Promise((resolve, reject) => {
    window.__lovableGmapsCb = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error("Google Maps failed to load"));
    };
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      libraries: "places",
      loading: "async",
      callback: "__lovableGmapsCb",
      ...(channel ? { channel } : {}),
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(s);
  });

  return loaderPromise;
}
