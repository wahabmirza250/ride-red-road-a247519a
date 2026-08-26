/**
 * Navigation integration boundary for the RedArt driver app.
 *
 * The driver app always navigates inside RedArt. Two implementations sit
 * behind one interface:
 *
 *  - Native turn-by-turn guidance (Google Maps Navigation SDK on the shipped
 *    Android/iOS builds), exposed to the web layer by the host app as
 *    `window.RedArtNavigation`. This one gives spoken guidance, a following
 *    camera with a vehicle puck, automatic re-routing and lane guidance.
 *  - The built-in guidance view used by the browser build: our own live map
 *    with the driving route, the driver's live position, the next manoeuvre,
 *    remaining distance and arrival time, and automatic recalculation when
 *    the driver leaves the route.
 *
 * Nothing here fakes native guidance: `capabilities` reports exactly what the
 * current device can do so the interface can tell the driver the truth.
 */
import { computeDriveRoute } from "@/lib/mapsRoute.functions";
import { metersBetween } from "@/lib/journey";

export type LatLng = { lat: number; lng: number };

export type Maneuver = {
  instruction: string;
  maneuver: string | null;
  distanceMeters: number;
  end: LatLng;
};

export type GuidanceUpdate = {
  /** Encoded driving line for the map. */
  path: LatLng[];
  steps: Maneuver[];
  distanceText: string;
  durationText: string;
  recalculated: boolean;
};

export type NavigationCapabilities = {
  /** Voice-guided, camera-following turn-by-turn from the device SDK. */
  nativeGuidance: boolean;
  voice: boolean;
  automaticRerouting: boolean;
  label: string;
};

export type NavigationSession = {
  stop(): void;
  /** Feed the latest device position; returns guidance when it changed. */
  update(position: LatLng): Promise<GuidanceUpdate | null>;
};

export type NavigationAdapter = {
  id: "native" | "built-in";
  capabilities: NavigationCapabilities;
  start(destination: LatLng, label: string): Promise<NavigationSession>;
};

type NativeBridge = {
  startNavigation(dest: { lat: number; lng: number; label: string }): Promise<void>;
  stopNavigation(): Promise<void>;
  getProgress?(): Promise<GuidanceUpdate | null>;
};

function nativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { RedArtNavigation?: NativeBridge }).RedArtNavigation;
  return b && typeof b.startNavigation === "function" ? b : null;
}

/** Off-route threshold before the route is recalculated automatically. */
const OFF_ROUTE_METERS = 60;
/** Movement needed before the route is refreshed on the built-in view. */
const REFRESH_METERS = 250;

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** True when the driver has left the calculated route. */
export function isOffRoute(path: LatLng[], position: LatLng, threshold = OFF_ROUTE_METERS) {
  if (path.length === 0) return false;
  let min = Infinity;
  for (const p of path) min = Math.min(min, metersBetween(p, position));
  return min > threshold;
}

const builtInAdapter: NavigationAdapter = {
  id: "built-in",
  capabilities: {
    nativeGuidance: false,
    voice: true,
    automaticRerouting: true,
    label: "Built-in guidance",
  },
  async start(destination) {
    let lastFrom: LatLng | null = null;
    let path: LatLng[] = [];
    let stopped = false;

    const fetchRoute = async (from: LatLng, recalculated: boolean): Promise<GuidanceUpdate | null> => {
      const r = await computeDriveRoute({ data: { from, to: destination } }).catch(() => null);
      if (!r) return null;
      path = decodePolyline(r.polyline);
      lastFrom = from;
      return {
        path,
        steps: (r.steps ?? []).map((s) => ({
          instruction: s.instruction,
          maneuver: s.maneuver ?? null,
          distanceMeters: s.distanceMeters,
          end: s.end,
        })),
        distanceText: r.distanceText,
        durationText: r.durationText,
        recalculated,
      };
    };

    return {
      stop() {
        stopped = true;
      },
      async update(position) {
        if (stopped) return null;
        if (!lastFrom) return fetchRoute(position, false);
        const moved = metersBetween(lastFrom, position);
        if (isOffRoute(path, position)) return fetchRoute(position, true);
        if (moved > REFRESH_METERS) return fetchRoute(position, false);
        return null;
      },
    };
  },
};

function makeNativeAdapter(bridge: NativeBridge): NavigationAdapter {
  return {
    id: "native",
    capabilities: {
      nativeGuidance: true,
      voice: true,
      automaticRerouting: true,
      label: "Turn-by-turn guidance",
    },
    async start(destination, label) {
      await bridge.startNavigation({ ...destination, label });
      let stopped = false;
      return {
        stop() {
          stopped = true;
          void bridge.stopNavigation();
        },
        async update() {
          if (stopped || !bridge.getProgress) return null;
          return (await bridge.getProgress()) ?? null;
        },
      };
    },
  };
}

export function getNavigationAdapter(): NavigationAdapter {
  const bridge = nativeBridge();
  return bridge ? makeNativeAdapter(bridge) : builtInAdapter;
}

export { builtInAdapter, decodePolyline };
