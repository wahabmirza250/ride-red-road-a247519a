import { useEffect, useState } from "react";

export type DriverMarker = {
  id: string;
  lat: number;
  lng: number;
  status: "available" | "on_trip" | "offline";
  label?: string;
};
export type GpsPoint = { lat: number; lng: number; t?: string | null };
export type StopDot = { lat: number; lng: number; label?: string };

type MapModule = {
  DriverFleetMap: React.ComponentType<{ center: [number, number]; markers: DriverMarker[] }>;
  RouteMap: React.ComponentType<{ center: [number, number]; path: GpsPoint[]; stops: StopDot[] }>;
  TrackMap: React.ComponentType<{
    center: [number, number];
    pickup?: [number, number] | null;
    dropoff?: [number, number] | null;
    driver?: [number, number] | null;
  }>;
};

function useMapModule(): MapModule | null {
  const [mod, setMod] = useState<MapModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    const path = "./MapView.client";
    import(/* @vite-ignore */ path).then((m) => {
      if (!cancelled) setMod(m as unknown as MapModule);
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
