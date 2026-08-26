/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { X, Loader2, Navigation, Navigation2, Map as MapIcon } from "lucide-react";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { useLiveEta } from "@/lib/useLiveEta";
import { openNavigation } from "@/lib/mapsDeepLink";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export type LatLng = { lat: number; lng: number };

type Props = {
  open: boolean;
  driver: LatLng | null;
  destination: LatLng;
  destinationLabel: string;
  destinationKind: "pickup" | "dropoff";
  /** Primary trip action shown at the bottom (e.g. "Arrived at Pickup"). */
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
};

/**
 * Full-screen route preview for the stop the driver is heading to.
 *
 * RedArt keeps the route, the passenger record, the times, the mileage and the
 * signatures. Driving directions open in Google Maps for the stop that is
 * current at that moment, so completing a stop and tapping Start Navigation
 * again opens directions to the new stop.
 */
export function InAppNavigation({
  open, driver, destination, destinationLabel, destinationKind,
  actionLabel, onAction, onClose,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const { theme } = useTheme();

  const eta = useLiveEta(driver, destination, open);

  useEffect(() => {
    if (!open) {
      setReady(false);
      mapRef.current = null;
      driverMarkerRef.current = null;
      destMarkerRef.current = null;
      lineRef.current = null;
      return;
    }
    let cancelled = false;
    loadGoogleMapsDark()
      .then((g) => {
        if (cancelled || !hostRef.current) return;
        mapRef.current = new g.maps.Map(hostRef.current, {
          center: driver ?? destination,
          zoom: 15,
          styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });
        mapRef.current.addListener("dragstart", () => setFollow(false));
        setReady(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load map"));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    mapRef.current?.setOptions({ styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE });
  }, [theme]);

  // Route line for the current stop.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!open || !ready || !g || !map) return;
    if (!eta.polyline) {
      lineRef.current?.setPath([]);
      return;
    }
    try {
      const path = g.maps.geometry.encoding.decodePath(eta.polyline);
      if (!lineRef.current) {
        lineRef.current = new g.maps.Polyline({
          map, strokeColor: "#f59e0b", strokeOpacity: 0.95, strokeWeight: 6,
        });
      }
      lineRef.current.setPath(path);
    } catch { /* geometry library unavailable */ }
  }, [open, ready, eta.polyline]);

  // Markers + camera follow.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!open || !ready || !g || !map) return;

    if (!destMarkerRef.current) destMarkerRef.current = new g.maps.Marker({ map });
    destMarkerRef.current.setOptions({
      position: destination,
      title: destinationLabel,
      icon: {
        path: g.maps.SymbolPath.CIRCLE, scale: 9,
        fillColor: destinationKind === "dropoff" ? "#ef4444" : "#22c55e",
        fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3,
      },
    });

    if (driver) {
      if (!driverMarkerRef.current) driverMarkerRef.current = new g.maps.Marker({ map, zIndex: 999 });
      driverMarkerRef.current.setOptions({
        position: driver,
        title: "You",
        icon: {
          path: g.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#f59e0b",
          fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3,
        },
      });
      if (follow) map.panTo(driver);
    }
  }, [open, ready, driver, destination, destinationLabel, destinationKind, follow]);

  if (!open) return null;

  function routeOverview() {
    setFollow(false);
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    const bounds = new g.maps.LatLngBounds();
    if (eta.polyline) {
      try {
        g.maps.geometry.encoding.decodePath(eta.polyline).forEach((p) => bounds.extend(p));
      } catch { /* geometry library unavailable */ }
    }
    if (driver) bounds.extend(driver);
    bounds.extend(destination);
    if (!bounds.isEmpty()) map.fitBounds(bounds, 64);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full" />
        {(!ready || err) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-muted text-xs text-muted-foreground">
            {err ? err : (<><Loader2 className="h-4 w-4 animate-spin" /> Opening route…</>)}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-3 top-3 space-y-2">
          <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface/95 p-4 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {destinationKind === "dropoff" ? "To drop-off" : "To pickup"}
              </div>
              <div className="truncate text-sm font-semibold">{destinationLabel}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{eta.label}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close route preview"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {!driver && (
            <div className="pointer-events-auto rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600">
              Waiting for your location — the route appears as soon as your position is found.
            </div>
          )}
        </div>

        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <Button size="sm" variant="secondary" className="rounded-full shadow" onClick={routeOverview}>
            <MapIcon className="mr-1.5 h-4 w-4" /> Route Overview
          </Button>
          <Button
            size="sm"
            variant={follow ? "default" : "secondary"}
            className="rounded-full shadow"
            onClick={() => setFollow(true)}
          >
            <Navigation2 className="mr-1.5 h-4 w-4" /> Re-center
          </Button>
        </div>
      </div>

      <div className="driver-nav-offset space-y-3 border-t border-border bg-surface px-4 pt-3">
        <Button
          className="h-14 w-full rounded-2xl text-base font-semibold"
          onClick={() => openNavigation({ ...destination, address: destinationLabel })}
        >
          <Navigation className="mr-2 h-5 w-5" /> Start Navigation
        </Button>
        <Button
          variant="outline"
          className="h-12 w-full rounded-2xl text-sm font-semibold"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
