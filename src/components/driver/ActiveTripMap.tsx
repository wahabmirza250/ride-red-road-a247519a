/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Navigation, Loader2, Map as MapIcon } from "lucide-react";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { useLiveEta } from "@/lib/useLiveEta";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export type LatLng = { lat: number; lng: number };

type Props = {
  /** Driver's live GPS position (null until the first fix). */
  driver?: LatLng | null;
  /** The stop the driver is currently heading to. */
  destination?: LatLng | null;
  destinationLabel?: string;
  destinationKind?: "pickup" | "dropoff" | "stop";
  /** Opens Google Maps with driving directions to this stop. */
  onStartNavigation?: () => void;
  /** Opens the full route preview for this stop. */
  onRouteOverview?: () => void;
};

/**
 * Route preview for the driver's current stop: the driving line, the live
 * driver pin and an arrival time that keeps up with the vehicle. Driving
 * directions open in Google Maps from the one clear button below the map.
 */
export function ActiveTripMap({
  driver,
  destination,
  destinationLabel,
  destinationKind = "pickup",
  onStartNavigation,
  onRouteOverview,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { theme } = useTheme();

  const eta = useLiveEta(driver ?? null, destination ?? null, true);

  const destColor = destinationKind === "dropoff" ? "#ef4444" : "#22c55e";

  // Init once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsDark()
      .then((g) => {
        if (cancelled || !hostRef.current) return;
        mapRef.current = new g.maps.Map(hostRef.current, {
          center: destination ?? driver ?? { lat: 39.7392, lng: -104.9903 },
          zoom: 13,
          styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });
        setReady(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load map"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme restyle.
  useEffect(() => {
    mapRef.current?.setOptions({ styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE });
  }, [theme]);

  // Markers.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map) return;

    if (destination) {
      if (!destMarkerRef.current) destMarkerRef.current = new g.maps.Marker({ map });
      destMarkerRef.current.setOptions({
        position: destination,
        title: destinationLabel ?? "Next stop",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: destColor,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
    } else {
      destMarkerRef.current?.setMap(null);
      destMarkerRef.current = null;
    }

    if (driver) {
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = new g.maps.Marker({ map, zIndex: 999 });
      }
      driverMarkerRef.current.setOptions({
        position: driver,
        title: "You",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
    }

    if (!driver && destination) map.setCenter(destination);
  }, [ready, driver, destination, destinationLabel, destColor]);

  // Route line follows the current estimate.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map) return;
    if (!eta.polyline) {
      lineRef.current?.setPath([]);
      return;
    }
    const path = g.maps.geometry.encoding.decodePath(eta.polyline);
    if (!lineRef.current) {
      lineRef.current = new g.maps.Polyline({
        map,
        strokeColor: "#f59e0b",
        strokeOpacity: 0.95,
        strokeWeight: 5,
      });
    }
    lineRef.current.setPath(path);
    const bounds = new g.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    if (driver) bounds.extend(driver);
    if (destination) bounds.extend(destination);
    if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, eta.polyline]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="relative h-56 w-full sm:h-64">
        <div ref={hostRef} className="h-full w-full" />
        {(!ready || err) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-muted text-xs text-muted-foreground">
            {err ? err : (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading live map…</>)}
          </div>
        )}
        {ready && !err && !driver && (
          <div className="absolute inset-x-0 bottom-0 bg-surface/90 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
            Waiting for your GPS location…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {destinationKind === "dropoff" ? "To drop-off" : destinationKind === "stop" ? "To next stop" : "To pickup"}
          </div>
          <div className="text-sm font-semibold">{eta.label}</div>
          {destinationLabel && (
            <div className="max-w-[16rem] truncate text-xs text-muted-foreground">{destinationLabel}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRouteOverview && (
            <Button
              variant="ghost"
              className="h-11 rounded-full text-sm font-semibold"
              onClick={onRouteOverview}
            >
              <MapIcon className="mr-2 h-4 w-4" /> Route Overview
            </Button>
          )}
          {onStartNavigation && (
            <Button
              className="h-11 rounded-full px-5 text-sm font-semibold"
              onClick={onStartNavigation}
            >
              <Navigation className="mr-2 h-4 w-4" /> Start Navigation
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
