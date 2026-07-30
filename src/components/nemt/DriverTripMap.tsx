/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { useTheme } from "@/lib/theme";
import { computeDriveRoute } from "@/lib/mapsRoute.functions";


export type LatLng = { lat: number; lng: number };

type Props = {
  driver?: LatLng | null;
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  focus?: LatLng | null;
  className?: string;
};

/**
 * Dark-themed Google Map for the driver dashboard.
 * Shows the selected driver's live pin plus the current trip's pickup, dropoff
 * and a route polyline. Auto-fits to whatever points are present.
 */
export function DriverTripMap({ driver, pickup, dropoff, focus, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polyRef = useRef<google.maps.Polyline | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { theme } = useTheme();

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsDark()
      .then((g) => {
        if (cancelled || !hostRef.current) return;
        mapRef.current = new g.maps.Map(hostRef.current, {
          center: { lat: 39.7392, lng: -104.9903 },
          zoom: 11,
          styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          backgroundColor: theme === "dark" ? "#0f172a" : "#f8fafc",
          gestureHandling: "greedy",
        });
        setReady(true);
      })
      .catch((e) => setErr(e.message ?? "Failed to load map"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restyle when theme changes.
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setOptions({
      styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
      backgroundColor: theme === "dark" ? "#0f172a" : "#f8fafc",
    });
  }, [theme]);


  // Redraw markers + route when props change.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map) return;

    // Clear existing markers/polyline.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (polyRef.current) {
      polyRef.current.setMap(null);
      polyRef.current = null;
    }
    if (rendererRef.current) rendererRef.current.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);

    const bounds = new g.maps.LatLngBounds();
    const push = (p: LatLng | null | undefined, opts: google.maps.MarkerOptions) => {
      if (!p) return;
      const marker = new g.maps.Marker({ position: p, map, ...opts });
      markersRef.current.push(marker);
      bounds.extend(p);
    };

    push(pickup, {
      title: "Pickup",
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#22c55e",
        fillOpacity: 1,
        strokeColor: "#0f172a",
        strokeWeight: 2,
      },
    });
    push(dropoff, {
      title: "Dropoff",
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#ef4444",
        fillOpacity: 1,
        strokeColor: "#0f172a",
        strokeWeight: 2,
      },
    });
    push(driver, {
      title: "Driver",
      zIndex: 999,
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#38bdf8",
        fillOpacity: 1,
        strokeColor: "#f8fafc",
        strokeWeight: 3,
      },
    });

    // Route line via the Routes API (server-side); straight line on failure.
    if (pickup && dropoff) {
      const drawStraight = () => {
        polyRef.current?.setMap(null);
        polyRef.current = new g.maps.Polyline({
          path: [pickup, dropoff],
          geodesic: true,
          strokeColor: "#38bdf8",
          strokeOpacity: 0.8,
          strokeWeight: 3,
          map,
        });
      };
      computeDriveRoute({ data: { from: pickup, to: dropoff } })
        .then((route) => {
          if (!route) return drawStraight();
          polyRef.current?.setMap(null);
          polyRef.current = new g.maps.Polyline({
            path: g.maps.geometry.encoding.decodePath(route.polyline),
            strokeColor: "#38bdf8",
            strokeOpacity: 0.9,
            strokeWeight: 4,
            map,
          });
        })
        .catch(drawStraight);
    }

    // Fit / focus.
    if (focus) {
      map.panTo(focus);
      map.setZoom(14);
    } else if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 60);
    }
  }, [ready, driver, pickup, dropoff, focus]);

  return (
    <div className={className ?? "relative h-full w-full overflow-hidden rounded-2xl"}>
      <div ref={hostRef} className="h-full w-full" />
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 p-4 text-center text-xs text-slate-300">
          {err}
        </div>
      )}
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-xs text-slate-400">
          Loading map…
        </div>
      )}
    </div>
  );
}
