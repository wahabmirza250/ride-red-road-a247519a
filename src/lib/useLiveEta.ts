import { useEffect, useMemo, useReducer, useRef } from "react";
import { computeDriveRoute } from "@/lib/mapsRoute.functions";
import {
  destinationKey,
  etaReducer,
  etaText,
  initialEtaState,
  shouldRequestEta,
  type EtaState,
  type LatLng,
} from "@/lib/eta";

/**
 * Keeps the arrival time for the current stop honest and current.
 *
 * It recalculates as the driver moves, on a short timer, and the moment the
 * route advances to a new stop. Answers that arrive out of order are dropped,
 * requests stop when the screen closes, and a routing failure shows a clear
 * temporary state rather than an old estimate.
 */
export function useLiveEta(
  from: LatLng | null | undefined,
  destination: LatLng | null | undefined,
  enabled = true,
) {
  const [state, dispatch] = useReducer(etaReducer, initialEtaState);
  const stateRef = useRef<EtaState>(state);
  stateRef.current = state;
  const fromRef = useRef<LatLng | null>(from ?? null);
  fromRef.current = from ?? null;

  const destKey = destinationKey(destination ?? null);
  const destRef = useRef<LatLng | null>(destination ?? null);
  destRef.current = destination ?? null;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const maybeRequest = () => {
      const origin = fromRef.current;
      const dest = destRef.current;
      const now = Date.now();
      if (!origin || !dest || !destKey) return;
      if (!shouldRequestEta(stateRef.current, origin, destKey, now)) return;

      dispatch({ type: "request", from: origin, destKey, at: now });
      const seq = stateRef.current.seq + 1;
      computeDriveRoute({ data: { from: origin, to: dest } })
        .then((route) => {
          if (cancelled) return;
          dispatch({
            type: "result",
            seq,
            result: route
              ? {
                  distanceText: route.distanceText,
                  durationText: route.durationText,
                  polyline: route.polyline,
                }
              : null,
            at: Date.now(),
          });
        })
        .catch(() => {
          if (cancelled) return;
          dispatch({ type: "error", seq, at: Date.now() });
        });
    };

    maybeRequest();
    const timer = window.setInterval(maybeRequest, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, destKey, from?.lat, from?.lng]);

  // Leaving the screen or losing the stop resets the display.
  useEffect(() => {
    if (!enabled) dispatch({ type: "reset", destKey: null });
  }, [enabled]);

  return useMemo(() => ({ ...state, label: etaText(state) }), [state]);
}
