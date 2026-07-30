/// <reference types="google.maps" />
// Dedicated Google Maps loader for the driver dashboard.

import { resolveMapsBrowserKey } from "./mapsKey";

let loaderPromise: Promise<typeof google> | null = null;

declare global {
  interface Window {
    __lovableGmapsDarkCb?: () => void;
    google?: typeof google;
  }
}

export function loadGoogleMapsDark(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loaderPromise) return loaderPromise;

  loaderPromise = resolveMapsBrowserKey().then(
    (key) =>
      new Promise<typeof google>((resolve, reject) => {
        if (!key) {
          reject(new Error("Google Maps API key missing"));
          return;
        }
        window.__lovableGmapsDarkCb = () => {
          if (window.google?.maps) resolve(window.google);
          else reject(new Error("Google Maps failed to load"));
        };
        const s = document.createElement("script");
        const params = new URLSearchParams({
          key,
          libraries: "places,geometry",
          loading: "async",
          callback: "__lovableGmapsDarkCb",
        });
        s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
        s.async = true;
        s.defer = true;
        s.onerror = () => reject(new Error("Failed to load Google Maps script"));
        document.head.appendChild(s);
      }),
  );

  return loaderPromise!;
}


// Navy/dark map theme tuned to the dashboard palette.
export const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#cbd5e1" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0f172a" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0f172a" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#020617" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#334155" }] },
];

// Clean light map theme for day mode.
export const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f8fafc" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8fafc" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#e2e8f0" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#334155" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e2e8f0" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f1f5f9" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#cbd5e1" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dbeafe" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#60a5fa" }] },
];

