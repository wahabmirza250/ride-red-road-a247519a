// This module touches `window` (leaflet). Must ONLY be dynamically imported
// from useEffect. Never top-level import from a route/component.
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Marker } from "react-leaflet";
import L from "leaflet";
import type { ReactNode } from "react";

// Fix default marker icon (Leaflet + Vite bundling)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type DriverMarker = {
  id: string;
  lat: number;
  lng: number;
  status: "available" | "on_trip" | "offline";
  label?: string;
};

export function DriverFleetMap({
  center,
  markers,
}: {
  center: [number, number];
  markers: DriverMarker[];
}) {
  const color = (s: DriverMarker["status"]) =>
    s === "available" ? "#16a34a" : s === "on_trip" ? "#2563eb" : "#9ca3af";
  return (
    <MapContainer center={center} zoom={7} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution={OSM_ATTR} url={OSM_URL} />
      {markers.map((m) => (
        <CircleMarker
          key={m.id}
          center={[m.lat, m.lng]}
          radius={9}
          pathOptions={{ color: color(m.status), fillColor: color(m.status), fillOpacity: 0.85, weight: 2 }}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{m.label ?? m.id.slice(0, 8)}</div>
              <div className="text-muted-foreground">{m.status}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export type GpsPoint = { lat: number; lng: number; ts: number };
export type StopDot = { lat: number; lng: number; label?: string };

export function RouteMap({
  center,
  path,
  stops,
}: {
  center: [number, number];
  path: GpsPoint[];
  stops: StopDot[];
}) {
  return (
    <MapContainer center={center} zoom={path.length ? 12 : 7} style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution={OSM_ATTR} url={OSM_URL} />
      {path.length > 1 && (
        <Polyline
          positions={path.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.8 }}
        />
      )}
      {stops.map((s, i) => (
        <CircleMarker
          key={i}
          center={[s.lat, s.lng]}
          radius={7}
          pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9, weight: 2 }}
        >
          <Popup>{s.label ?? `Stop ${i + 1}`}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export function TrackMap({
  center,
  pickup,
  dropoff,
  driver,
}: {
  center: [number, number];
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driver?: [number, number] | null;
}) {
  return (
    <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution={OSM_ATTR} url={OSM_URL} />
      {pickup && (
        <Marker position={pickup}>
          <Popup>Pickup</Popup>
        </Marker>
      )}
      {dropoff && (
        <Marker position={dropoff}>
          <Popup>Dropoff</Popup>
        </Marker>
      )}
      {driver && (
        <CircleMarker
          center={driver}
          radius={10}
          pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9, weight: 2 }}
        >
          <Popup>Your driver</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}

// Passthrough so we can also render arbitrary map children if needed
export function BaseMap({ center, zoom, children }: { center: [number, number]; zoom: number; children?: ReactNode }) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution={OSM_ATTR} url={OSM_URL} />
      {children}
    </MapContainer>
  );
}
