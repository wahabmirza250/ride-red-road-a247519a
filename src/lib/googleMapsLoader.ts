/// <reference types="google.maps" />
// Loads the Google Maps JS API once, with Places lib, using loading=async.
// Safe to call from multiple components — subsequent calls return the same promise.

import { resolveMapsBrowserKey } from "./mapsKey";

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

  loaderPromise = resolveMapsBrowserKey().then(
    (key) =>
      new Promise<typeof google>((resolve, reject) => {
        if (!key) {
          reject(new Error("Google Maps browser key missing"));
          return;
        }
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
        });
        const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
        if (channel) params.set("channel", channel);
        s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
        s.async = true;
        s.defer = true;
        s.onerror = () => {
          loaderPromise = null;
          reject(new Error("Failed to load Google Maps script"));
        };
        document.head.appendChild(s);
      }),
  );

  return loaderPromise!;
}

