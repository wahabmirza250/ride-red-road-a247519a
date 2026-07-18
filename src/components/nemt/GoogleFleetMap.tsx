/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { useTheme } from "@/lib/theme";


export type FleetMarker = {
  id: string;
  lat: number;
  lng: number;
  status: "available" | "busy" | "offline";
  label?: string;
};

const STATUS_COLOR: Record<FleetMarker["status"], string> = {
  available: "#22c55e", // green
  busy: "#38bdf8", // blue
  offline: "#94a3b8", // slate
};

/** Google Maps-based fleet view for Live Ops — multi-driver markers, dark tiles, auto-fit. */
export function GoogleFleetMap({
  center,
  markers,
  focus,
  className,
  onMarkerClick,
}: {
  center: [number, number];
  markers: FleetMarker[];
  focus?: { lat: number; lng: number; zoom?: number } | null;
  className?: string;
  onMarkerClick?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsDark()
      .then((g) => {
        if (cancelled || !hostRef.current) return;
        mapRef.current = new g.maps.Map(hostRef.current, {
          center: { lat: center[0], lng: center[1] },
          zoom: 11,
          styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          backgroundColor: theme === "dark" ? "#0f172a" : "#f8fafc",
          gestureHandling: "greedy",
        });
        setReady(true);
      })
      .catch((e: Error) => setErr(e.message ?? "Failed to load map"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center]);

  // Restyle when theme changes.
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setOptions({
      styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
      backgroundColor: theme === "dark" ? "#0f172a" : "#f8fafc",
    });
  }, [theme]);


  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new g.maps.LatLngBounds();
    markers.forEach((m) => {
      const marker = new g.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map,
        title: m.label ?? "Driver",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: STATUS_COLOR[m.status],
          fillOpacity: 1,
          strokeColor: "#0f172a",
          strokeWeight: 2.5,
        },
      });
      if (onMarkerClick) marker.addListener("click", () => onMarkerClick(m.id));
      markersRef.current.push(marker);
      bounds.extend({ lat: m.lat, lng: m.lng });
    });

    if (focus) {
      map.panTo({ lat: focus.lat, lng: focus.lng });
      map.setZoom(focus.zoom ?? 14);
    } else if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 60);
    }
  }, [ready, markers, focus, onMarkerClick]);

  return (
    <div className={className ?? "relative h-full w-full overflow-hidden"}>
      <div ref={hostRef} className="h-full w-full" />
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-xs text-muted-foreground">
          {err}
        </div>
      )}
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-xs text-muted-foreground">
          Loading map…
        </div>
      )}
    </div>
  );
}
