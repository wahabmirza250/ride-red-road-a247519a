// Google-Maps-style leaflet map with Uber-style pill markers.
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, type ReactNode } from "react";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export type DriverMarker = {
  id: string;
  lat: number;
  lng: number;
  status: "available" | "on_trip" | "offline";
  label?: string;
};

function pillIcon(m: DriverMarker) {
  const dot =
    m.status === "available" ? "#22c55e" : m.status === "on_trip" ? "#f59e0b" : "#9ca3af";
  const name = (m.label || "Driver").replace(/</g, "&lt;");
  const html = `
    <div style="transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:6px;
                background:#0a0a0a;color:#fff;padding:4px 10px 4px 8px;border-radius:9999px;
                box-shadow:0 6px 14px rgba(0,0,0,.25);font:600 12px/1.2 system-ui,sans-serif;
                white-space:nowrap;position:relative;">
      <span style="width:8px;height:8px;border-radius:9999px;background:${dot};box-shadow:0 0 0 2px rgba(255,255,255,.15);"></span>
      <span>${name}</span>
      <span style="position:absolute;left:50%;bottom:-5px;transform:translateX(-50%);
                   width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;
                   border-top:6px solid #0a0a0a;"></span>
    </div>`;
  return L.divIcon({ html, className: "uber-pill", iconSize: [0, 0], iconAnchor: [0, 0] });
}

function FocusController({
  focus,
  markers,
}: {
  focus?: { lat: number; lng: number; zoom?: number } | null;
  markers: DriverMarker[];
}) {
  const map = useMap();
  useEffect(() => {
    if (focus) {
      map.flyTo([focus.lat, focus.lng], focus.zoom ?? 15, { duration: 0.8 });
    }
  }, [focus, map]);
  useEffect(() => {
    if (focus) return;
    if (markers.length > 1) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
    // else keep the initial center/zoom (city default)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers.length]);
  return null;
}

export function DriverFleetMap({
  center,
  markers,
  focus,
}: {
  center: [number, number];
  markers: DriverMarker[];
  focus?: { lat: number; lng: number; zoom?: number } | null;
}) {
  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution={OSM_ATTR} url={OSM_URL} />
      <FocusController focus={focus} markers={markers} />
      {markers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={pillIcon(m)}>
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{m.label ?? "Driver"}</div>
              <div className="text-muted-foreground">{m.status.replace(/_/g, " ")}</div>
            </div>
          </Popup>
        </Marker>
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

export function BaseMap({ center, zoom, children }: { center: [number, number]; zoom: number; children?: ReactNode }) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution={OSM_ATTR} url={OSM_URL} />
      {children}
    </MapContainer>
  );
}
