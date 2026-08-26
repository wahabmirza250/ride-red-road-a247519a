/**
 * Live arrival-time model for the driver app.
 *
 * The arrival time shown to a driver must always describe where they are right
 * now. This module owns that rule as plain, testable logic:
 *
 *  - a new estimate is requested when the driver has moved meaningfully, when
 *    the route points at a new stop, or after a short refresh interval;
 *  - a late answer can never overwrite a newer one (each request carries a
 *    sequence number and older answers are dropped);
 *  - when routing is unavailable the driver sees "ETA unavailable" instead of
 *    an old value presented as current.
 */

export type LatLng = { lat: number; lng: number };

export type EtaStatus = "idle" | "updating" | "ready" | "unavailable";

export type EtaState = {
  status: EtaStatus;
  distanceText: string | null;
  durationText: string | null;
  polyline: string | null;
  /** Sequence number of the newest request that has been issued. */
  seq: number;
  /** Sequence number of the newest answer that has been applied. */
  appliedSeq: number;
  destKey: string | null;
  requestedFrom: LatLng | null;
  requestedAt: number | null;
  updatedAt: number | null;
};

export type EtaResult = {
  distanceText: string;
  durationText: string;
  polyline: string;
} | null;

export type EtaEvent =
  | { type: "request"; from: LatLng; destKey: string; at: number }
  | { type: "result"; seq: number; result: EtaResult; at: number }
  | { type: "error"; seq: number; at: number }
  | { type: "reset"; destKey: string | null };

/** How long an estimate may stand before it is refreshed. */
export const ETA_REFRESH_MS = 25_000;
/** How far the driver must move before the estimate is recalculated. */
export const ETA_MOVE_METERS = 120;

export const initialEtaState: EtaState = {
  status: "idle",
  distanceText: null,
  durationText: null,
  polyline: null,
  seq: 0,
  appliedSeq: 0,
  destKey: null,
  requestedFrom: null,
  requestedAt: null,
  updatedAt: null,
};

export function destinationKey(dest: LatLng | null | undefined): string | null {
  if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return null;
  return `${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
}

export function metersApart(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** True when a fresh estimate should be requested right now. */
export function shouldRequestEta(
  state: EtaState,
  from: LatLng | null,
  destKey: string | null,
  now: number,
): boolean {
  if (!from || !destKey) return false;
  // A pending request that hasn't answered yet is left alone for a while.
  const pending = state.seq > state.appliedSeq;
  if (destKey !== state.destKey) return true;
  if (pending) return now - (state.requestedAt ?? 0) > ETA_REFRESH_MS * 2;
  if (state.status === "idle") return true;
  if (state.requestedFrom && metersApart(state.requestedFrom, from) >= ETA_MOVE_METERS) return true;
  return now - (state.updatedAt ?? state.requestedAt ?? 0) >= ETA_REFRESH_MS;
}

export function etaReducer(state: EtaState, event: EtaEvent): EtaState {
  switch (event.type) {
    case "reset":
      return {
        ...initialEtaState,
        seq: state.seq,
        appliedSeq: state.seq,
        destKey: event.destKey,
      };
    case "request":
      return {
        ...state,
        // A new stop clears the previous stop's numbers immediately, so an old
        // arrival time is never shown for a new destination.
        ...(event.destKey !== state.destKey
          ? { distanceText: null, durationText: null, polyline: null, updatedAt: null }
          : {}),
        status: "updating",
        seq: state.seq + 1,
        destKey: event.destKey,
        requestedFrom: event.from,
        requestedAt: event.at,
      };
    case "result": {
      if (event.seq < state.seq) return state; // a newer request is in flight
      if (event.seq <= state.appliedSeq) return state; // an older answer arrived late
      if (!event.result) {
        return {
          ...state,
          status: "unavailable",
          distanceText: null,
          durationText: null,
          polyline: null,
          appliedSeq: event.seq,
          updatedAt: event.at,
        };
      }
      return {
        ...state,
        status: "ready",
        distanceText: event.result.distanceText,
        durationText: event.result.durationText,
        polyline: event.result.polyline,
        appliedSeq: event.seq,
        updatedAt: event.at,
      };
    }
    case "error": {
      if (event.seq < state.seq) return state;
      if (event.seq <= state.appliedSeq) return state;
      return {
        ...state,
        status: "unavailable",
        distanceText: null,
        durationText: null,
        polyline: null,
        appliedSeq: event.seq,
        updatedAt: event.at,
      };
    }
    default:
      return state;
  }
}

/** Driver-facing arrival line — never a stale number dressed up as current. */
export function etaText(state: EtaState): string {
  if (state.status === "ready" && state.durationText) {
    return state.distanceText ? `${state.durationText} · ${state.distanceText}` : state.durationText;
  }
  if (state.status === "unavailable") return "ETA unavailable";
  return "Updating ETA…";
}
