/// <reference types="google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Volume2, VolumeX, Loader2, CornerUpLeft, CornerUpRight,
  ArrowUp, RotateCcw, MapPin, Navigation2,
} from "lucide-react";
import { loadGoogleMapsDark, DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/lib/googleMapsDark";
import { computeDriveRoute, type ComputedRoute, type RouteStep } from "@/lib/mapsRoute.functions";
import { browserDriveRoute } from "@/lib/navBrowser";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { haversineKm } from "@/lib/rideMath";

export type LatLng = { lat: number; lng: number };

type Props = {
  open: boolean;
  driver: LatLng | null;
  destination: LatLng;
  destinationLabel: string;
  destinationKind: "pickup" | "dropoff";
  /** Primary action shown at the bottom (e.g. "Arrive at pickup"). */
  actionLabel: string;
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

function metersText(m: number): string {
  const feet = m * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  return `${(m / 1609.34).toFixed(1)} mi`;
}

/**
 * Full-screen, in-app turn-by-turn navigation.
 *
 * Everything stays inside the driver app: our branded live map draws the route
 * line and the live driver pin, while the ordered maneuver list comes from the
 * Routes API (server) with a browser Directions fallback. The current step
 * advances automatically as the driver's GPS passes each maneuver point, and
 * can be spoken aloud.
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
  const spokenRef = useRef<string>("");
  const routeKeyRef = useRef<string>("");

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [route, setRoute] = useState<ComputedRoute>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [follow, setFollow] = useState(true);
  const { theme } = useTheme();

  // Create the map when the overlay opens.
  useEffect(() => {
    if (!open) {
      setReady(false);
      mapRef.current = null;
      driverMarkerRef.current = null;
      destMarkerRef.current = null;
      lineRef.current = null;
      routeKeyRef.current = "";
      return;
    }
    let cancelled = false;
    loadGoogleMapsDark()
      .then((g) => {
        if (cancelled || !hostRef.current) return;
        mapRef.current = new g.maps.Map(hostRef.current, {
          center: driver ?? destination,
          zoom: 16,
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

  // Fetch the route + steps (server first, browser fallback).
  const fetchRoute = useCallback(async (from: LatLng) => {
    try {
      const r = await computeDriveRoute({ data: { from, to: destination } });
      if (r) return r;
    } catch { /* fall through */ }
    try {
      return await browserDriveRoute(from, destination);
    } catch {
      return null;
    }
  }, [destination]);

  // (Re)compute the route when the driver moves meaningfully.
  useEffect(() => {
    if (!open || !ready || !driver) return;
    const key = `${driver.lat.toFixed(3)},${driver.lng.toFixed(3)}`;
    if (key === routeKeyRef.current) return;
    routeKeyRef.current = key;
    let cancelled = false;
    void fetchRoute(driver).then((r) => {
      if (cancelled || !r) return;
      setRoute(r);
      const g = window.google;
      const map = mapRef.current;
      if (!g || !map) return;
      try {
        const path = g.maps.geometry.encoding.decodePath(r.polyline);
        if (!lineRef.current) {
          lineRef.current = new g.maps.Polyline({
            map, strokeColor: "#f59e0b", strokeOpacity: 0.95, strokeWeight: 6,
          });
        }
        lineRef.current.setPath(path);
      } catch { /* geometry lib unavailable */ }
    });
    return () => { cancelled = true; };
  }, [open, ready, driver, fetchRoute]);

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

  // Advance the current step as the driver passes each maneuver point.
  useEffect(() => {
    const steps = route?.steps ?? [];
    if (!driver || steps.length === 0) return;
    let idx = stepIndex;
    while (idx < steps.length - 1 && haversineKm(driver, steps[idx].end) * 1000 < 40) idx += 1;
    if (idx !== stepIndex) setStepIndex(idx);
  }, [driver, route, stepIndex]);

  const steps: RouteStep[] = route?.steps ?? [];
  const current = steps[stepIndex] ?? null;
  const nextStep = steps[stepIndex + 1] ?? null;
  const remainingMeters = driver ? haversineKm(driver, destination) * 1000 : null;

  // Speak each new instruction once.
  useEffect(() => {
    if (!open || muted || !current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const phrase = `In ${metersText(current.distanceMeters)}, ${current.instruction}`;
    if (spokenRef.current === phrase) return;
    spokenRef.current = phrase;
    try {
      const u = new SpeechSynthesisUtterance(phrase);
      u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch { /* speech unsupported */ }
  }, [open, muted, current]);

  useEffect(() => {
    if (!open && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      spokenRef.current = "";
      setStepIndex(0);
    }
  }, [open]);

  if (!open) return null;

  const Icon = maneuverIcon(current?.maneuver ?? null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Live map */}
      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full" />
        {(!ready || err) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950 text-xs text-slate-300">
            {err ? err : (<><Loader2 className="h-4 w-4 animate-spin" /> Starting navigation…</>)}
          </div>
        )}

        {/* Current maneuver banner */}
        <div className="pointer-events-none absolute inset-x-3 top-3">
          <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-slate-900/95 p-4 text-white shadow-lg ring-1 ring-white/10">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950">
              <Icon className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              {current ? (
                <>
                  <div className="text-xl font-bold leading-tight">
                    {metersText(current.distanceMeters)}
                  </div>
                  <div className="text-sm leading-snug text-slate-200">{current.instruction}</div>
                  {nextStep && (
                    <div className="mt-1 truncate text-[11px] text-slate-400">
                      Then {nextStep.instruction}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-slate-300">
                  {driver ? "Calculating turn-by-turn directions…" : "Waiting for your GPS location…"}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={onClose}
                aria-label="Exit navigation"
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute voice guidance" : "Mute voice guidance"}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {!follow && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1 rounded-full bg-slate-900/90 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10"
          >
            <Navigation2 className="h-4 w-4" /> Re-center
          </button>
        )}
      </div>

      {/* Trip strip + primary action */}
      <div className="space-y-3 border-t border-white/10 bg-slate-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-slate-400">
              {destinationKind === "dropoff" ? "To dropoff" : "To pickup"}
            </div>
            <div className="truncate text-sm text-slate-200">{destinationLabel}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold">{route?.durationText ?? "—"}</div>
            <div className="text-xs text-slate-400">
              {route?.distanceText ?? (remainingMeters != null ? metersText(remainingMeters) : "")}
            </div>
          </div>
        </div>
        <Button
          className="h-14 w-full rounded-full bg-amber-500 text-base font-semibold text-slate-950 hover:bg-amber-400"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
