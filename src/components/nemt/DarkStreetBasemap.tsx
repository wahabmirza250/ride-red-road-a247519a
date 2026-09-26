import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";
import { navyMapStyle } from "@/lib/navyMapStyle";

const ATTRIBUTION = '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>';
setWorkerUrl(mapWorkerUrl);

export function DarkStreetBasemap() {
  const map = useMap();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let layer: ReturnType<typeof maplibreGL> | undefined;
    setFailed(false);
    map.attributionControl?.addAttribution(ATTRIBUTION);
    async function load() {
      try {
        const response = await fetch("https://tiles.openfreemap.org/styles/dark", { signal: controller.signal });
        if (!response.ok) throw new Error("Map style unavailable");
        const style = navyMapStyle(await response.json() as StyleSpecification);
        if (controller.signal.aborted) return;
        layer = maplibreGL({ style, attributionControl: false });
        layer.addTo(map);
        const renderer = layer.getMaplibreMap();
        renderer.on("error", () => { if (!controller.signal.aborted) setFailed(true); });
        renderer.on("idle", () => { if (!controller.signal.aborted) setFailed(false); });
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
      map.attributionControl?.removeAttribution(ATTRIBUTION);
    };
  }, [map, attempt]);

  if (!failed) return null;
  return <button type="button" className="absolute left-14 top-3 z-[500] rounded-lg bg-slate-800 px-3 py-2 text-xs text-white" onClick={() => setAttempt((value) => value + 1)}>Reload map</button>;
}
