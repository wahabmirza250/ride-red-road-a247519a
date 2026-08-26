/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, Map as MapIcon, Navigation, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { useTheme } from "@/lib/theme";
import { useLiveEta } from "@/lib/useLiveEta";
import { openNavigation } from "@/lib/mapsDeepLink";
import type { LatLng } from "@/lib/eta";
import type { JourneyStop } from "@/lib/journey";

type Props = {
  open: boolean;
  stop: JourneyStop;
  /** Live device position; null until the first location fix arrives. */
  position: LatLng | null;
  /** Text of the primary action, e.g. "Arrived at Pickup". */
  actionLabel: string;
  actionDisabled?: boolean;
  progressLabel: string;
  onAction: () => void;
  onClose: () => void;
};

/**
 * Route preview for the driver's next stop.
 *
 * RedArt keeps the stop order, passenger state, times, mileage, odometer and
 * signatures. Driving directions open in Google Maps for the stop that is
 * current right now — when a stop is completed the route moves on, and the
 * next tap of Start Navigation opens directions to the new stop.
 */
export function JourneyNavigation({
  open, stop, position, actionLabel, actionDisabled, progressLabel, onAction, onClose,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const puckRef = useRef<google.maps.Marker | null>(null);
  const destRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const { theme } = useTheme();

  const destination: LatLng | null =
    stop.lat != null && stop.lng != null ? { lat: Number(stop.lat), lng: Number(stop.lng) } : null;

  const eta = useLiveEta(position, destination, open);

  /* ------------------------------- the map ------------------------------- */
  useEffect(() => {
    if (!open) {
      setReady(false);
      mapRef.current = null;
      puckRef.current = null;
      destRef.current = null;
      lineRef.current = null;
      return;
    }
    let cancelled = false;
    loadGoogleMapsDark()
      .then((g) => {
        if (cancelled || !hostRef.current) return;
        mapRef.current = new g.maps.Map(hostRef.current, {
          center: position ?? destination ?? { lat: 39.7392, lng: -104.9903 },
          zoom: 15,
          styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          gestureHandling: "greedy",
        });
        mapRef.current.addListener("dragstart", () => setFollow(false));
        setReady(true);
      })
      .catch((e) => setMapError(e instanceof Error ? e.message : "Map unavailable"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    mapRef.current?.setOptions({ styles: theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE });
  }, [theme]);

  // Route line for the current stop.
  useEffect(() => {
    const gm = window.google;
    const map = mapRef.current;
    if (!ready || !gm || !map) return;
    if (!eta.polyline) {
      lineRef.current?.setPath([]);
      return;
    }
    const path = gm.maps.geometry.encoding.decodePath(eta.polyline);
    if (!lineRef.current) {
      lineRef.current = new gm.maps.Polyline({
        map,
        strokeColor: "#f59e0b",
        strokeOpacity: 0.95,
        strokeWeight: 6,
      });
    }
    lineRef.current.setPath(path);
  }, [ready, eta.polyline]);

  // Driver pin, stop pin and camera follow.
  useEffect(() => {
    const gm = window.google;
    const map = mapRef.current;
    if (!ready || !gm || !map) return;

    if (destination) {
      if (!destRef.current) destRef.current = new gm.maps.Marker({ map });
      destRef.current.setOptions({
        position: destination,
        title: stop.address,
        icon: {
          path: gm.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: stop.kind === "pickup" ? "#22c55e" : "#ef4444",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
    }
    if (position) {
      if (!puckRef.current) puckRef.current = new gm.maps.Marker({ map, zIndex: 999 });
      puckRef.current.setOptions({
        position,
        title: "Your vehicle",
        icon: {
          path: gm.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
      if (follow) {
        map.panTo(position);
        map.setZoom(Math.max(map.getZoom() ?? 15, 15));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, position, follow, stop.id]);

  if (!open) return null;

  function routeOverview() {
    setFollow(false);
    const gm = window.google;
    const map = mapRef.current;
    if (!gm || !map) return;
    const bounds = new gm.maps.LatLngBounds();
    if (eta.polyline) {
      gm.maps.geometry.encoding.decodePath(eta.polyline).forEach((p) => bounds.extend(p));
    }
    if (position) bounds.extend(position);
    if (destination) bounds.extend(destination);
    if (!bounds.isEmpty()) map.fitBounds(bounds, 64);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full" />

        <div className="pointer-events-none absolute inset-x-3 top-3 space-y-2">
          <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Next Stop · {progressLabel}
              </div>
              <div className="truncate text-base font-semibold">
                {stop.kind === "pickup" ? "Pickup" : "Drop-off"} · {stop.passenger_name}
              </div>
              <div className="truncate text-xs text-muted-foreground">{stop.address}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums">{eta.label}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close route preview"
              className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {!position && (
            <div className="pointer-events-auto rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600">
              Waiting for your location — the route appears as soon as your position is found.
            </div>
          )}
          {mapError && (
            <div className="pointer-events-auto rounded-xl bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive">
              Map unavailable — you can still start navigation and record this stop.
            </div>
          )}
        </div>

        <div className="absolute bottom-4 right-3 flex flex-col gap-2">
          <Button size="sm" variant="secondary" className="rounded-full shadow" onClick={routeOverview}>
            <MapIcon className="mr-1.5 h-4 w-4" /> Route Overview
          </Button>
          <Button
            size="sm"
            variant={follow ? "default" : "secondary"}
            className="rounded-full shadow"
            onClick={() => setFollow(true)}
          >
            <Crosshair className="mr-1.5 h-4 w-4" /> Re-center
          </Button>
        </div>

        {!ready && !mapError && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-muted text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening route…
          </div>
        )}
      </div>

      <div className="driver-nav-offset space-y-3 border-t border-border bg-surface px-4 pt-3">
        {stop.medicaid_id && (
          <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Member ID {stop.medicaid_id}
          </div>
        )}
        <Button
          className="h-14 w-full rounded-2xl text-base font-semibold"
          onClick={() => openNavigation({ lat: stop.lat, lng: stop.lng, address: stop.address })}
        >
          <Navigation className="mr-2 h-5 w-5" /> Start Navigation
        </Button>
        <Button
          variant="outline"
          className="h-12 w-full rounded-2xl text-sm font-semibold"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
