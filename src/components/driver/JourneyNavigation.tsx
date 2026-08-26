/// <reference types="google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp, CornerUpLeft, CornerUpRight, Crosshair, Loader2, MapPin, Map as MapIcon,
  RotateCcw, ShieldCheck, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { useTheme } from "@/lib/theme";
import {
  getNavigationAdapter,
  type GuidanceUpdate,
  type LatLng,
  type NavigationSession,
} from "@/lib/navigation/adapter";
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

function maneuverIcon(m: string | null) {
  const k = (m ?? "").toLowerCase();
  if (k.includes("left")) return CornerUpLeft;
  if (k.includes("right")) return CornerUpRight;
  if (k.includes("uturn")) return RotateCcw;
  if (k.includes("destination")) return MapPin;
  return ArrowUp;
}

function distanceText(meters: number) {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 50) * 50} ft`;
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

/**
 * Full-screen in-app navigation for the driver's next stop.
 *
 * The driver stays inside RedArt: live position, the driving route, the next
 * manoeuvre, remaining distance and arrival time, automatic recalculation when
 * the route is left, plus Route Overview and Re-center controls. On builds
 * that ship device turn-by-turn guidance, the same screen drives the native
 * navigation session instead.
 */
export function JourneyNavigation({
  open, stop, position, actionLabel, actionDisabled, progressLabel, onAction, onClose,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const puckRef = useRef<google.maps.Marker | null>(null);
  const destRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const sessionRef = useRef<NavigationSession | null>(null);
  const headingRef = useRef<number>(0);
  const lastPosRef = useRef<LatLng | null>(null);

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<GuidanceUpdate | null>(null);
  const [follow, setFollow] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const { theme } = useTheme();

  const adapter = getNavigationAdapter();
  const destination: LatLng | null =
    stop.lat != null && stop.lng != null ? { lat: Number(stop.lat), lng: Number(stop.lng) } : null;

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
          zoom: 16,
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

  /* --------------------------- guidance session --------------------------- */
  useEffect(() => {
    if (!open || !destination) return;
    let cancelled = false;
    setGuidance(null);
    adapter
      .start(destination, `${stop.kind === "pickup" ? "Pickup" : "Drop-off"} — ${stop.address}`)
      .then((s) => {
        if (cancelled) {
          s.stop();
          return;
        }
        sessionRef.current = s;
      })
      .catch(() => setGuidance(null));
    return () => {
      cancelled = true;
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stop.id]);

  const applyGuidance = useCallback((g: GuidanceUpdate) => {
    setGuidance(g);
    setRecalculating(false);
    const gm = window.google;
    const map = mapRef.current;
    if (!gm || !map || g.path.length === 0) return;
    if (!lineRef.current) {
      lineRef.current = new gm.maps.Polyline({
        map,
        strokeColor: "#f59e0b",
        strokeOpacity: 0.95,
        strokeWeight: 6,
      });
    }
    lineRef.current.setPath(g.path);
  }, []);

  // Feed each new position to the guidance session.
  useEffect(() => {
    if (!open || !position || !sessionRef.current) return;
    const prev = lastPosRef.current;
    if (prev) {
      const dy = position.lat - prev.lat;
      const dx = position.lng - prev.lng;
      if (Math.abs(dy) + Math.abs(dx) > 1e-6) {
        headingRef.current = (Math.atan2(dx, dy) * 180) / Math.PI;
      }
    }
    lastPosRef.current = position;
    setRecalculating(true);
    void sessionRef.current
      .update(position)
      .then((g) => {
        if (g) applyGuidance(g);
        else setRecalculating(false);
      })
      .catch(() => setRecalculating(false));
  }, [open, position, applyGuidance]);

  // Driver puck, destination pin and camera follow.
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
          path: gm.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          rotation: headingRef.current,
          fillColor: "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      if (follow) {
        map.panTo(position);
        map.setZoom(Math.max(map.getZoom() ?? 16, 16));
      }
    }
  }, [ready, position, follow, destination, stop.address, stop.kind]);

  if (!open) return null;

  const step = guidance?.steps?.[0] ?? null;
  const Icon = maneuverIcon(step?.maneuver ?? null);
  const guidanceUnavailable = !destination || (!guidance && !recalculating && ready);

  function routeOverview() {
    setFollow(false);
    const gm = window.google;
    const map = mapRef.current;
    if (!gm || !map) return;
    const bounds = new gm.maps.LatLngBounds();
    (guidance?.path ?? []).forEach((p) => bounds.extend(p));
    if (position) bounds.extend(position);
    if (destination) bounds.extend(destination);
    if (!bounds.isEmpty()) map.fitBounds(bounds, 64);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full" />

        {/* Next manoeuvre */}
        <div className="pointer-events-none absolute inset-x-3 top-3 space-y-2">
          <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="rounded-xl bg-primary/15 p-2 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {step ? step.instruction : recalculating ? "Finding the best route…" : "Follow the route"}
              </div>
              <div className="text-xs text-muted-foreground">
                {step ? distanceText(step.distanceMeters) : progressLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {!position && (
            <div className="pointer-events-auto rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600">
              Waiting for your location — hold tight, the route starts as soon as your position is found.
            </div>
          )}
          {guidanceUnavailable && position && (
            <div className="pointer-events-auto rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600">
              Navigation unavailable — mileage and trip times are still being recorded.
            </div>
          )}
          {mapError && (
            <div className="pointer-events-auto rounded-xl bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive">
              Map unavailable — you can still record this stop.
            </div>
          )}
        </div>

        {/* Map controls */}
        <div className="absolute bottom-4 right-3 flex flex-col gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full shadow"
            onClick={routeOverview}
          >
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
            <Loader2 className="h-4 w-4 animate-spin" /> Opening navigation…
          </div>
        )}
      </div>

      {/* Next stop + primary action */}
      <div className="driver-nav-offset space-y-3 border-t border-border bg-surface px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Next Stop · {progressLabel}
            </div>
            <div className="truncate text-sm font-semibold">
              {stop.kind === "pickup" ? "Pickup" : "Drop-off"} · {stop.passenger_name}
            </div>
            <div className="truncate text-xs text-muted-foreground">{stop.address}</div>
            {stop.medicaid_id && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3" /> Member ID {stop.medicaid_id}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold">{guidance?.durationText ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{guidance?.distanceText ?? ""}</div>
          </div>
        </div>
        <Button
          className="h-12 w-full rounded-xl text-sm font-semibold"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
