import { useEffect, useState } from "react";
import type {
  DriverMarker,
  GpsPoint,
  StopDot,
} from "@/components/nemt/MapView.client";

type MapModule = typeof import("@/components/nemt/MapView.client");

function useMapModule(): MapModule | null {
  const [mod, setMod] = useState<MapModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/components/nemt/MapView.client").then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return mod;
}

function MapFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-muted text-xs text-muted-foreground">
      Loading map…
    </div>
  );
}

export function DriverFleetMap(props: { center: [number, number]; markers: DriverMarker[] }) {
  const mod = useMapModule();
  if (!mod) return <MapFallback />;
  const C = mod.DriverFleetMap;
  return <C {...props} />;
}

export function RouteMap(props: {
  center: [number, number];
  path: GpsPoint[];
  stops: StopDot[];
}) {
  const mod = useMapModule();
  if (!mod) return <MapFallback />;
  const C = mod.RouteMap;
  return <C {...props} />;
}

export function TrackMap(props: {
  center: [number, number];
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driver?: [number, number] | null;
}) {
  const mod = useMapModule();
  if (!mod) return <MapFallback />;
  const C = mod.TrackMap;
  return <C {...props} />;
}
