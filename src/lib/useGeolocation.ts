import { useEffect, useState } from "react";

export function useCurrentPosition() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErr("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setErr(e.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);
  return { pos, err };
}

/** Request a one-shot position. Rejects with a human-readable error. */
export function requestCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => {
        const msg =
          e.code === 1
            ? "Location permission denied. Enable it in your browser or phone settings."
            : e.code === 2
              ? "Location unavailable. Check GPS / network signal."
              : e.code === 3
                ? "Location timed out. Try again."
                : e.message || "Could not get location";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

/**
 * Stream the device location while `enabled` is true. Uses watchPosition so
 * the OS decides when to fire updates (battery-friendly, reliable on mobile),
 * with a heartbeat interval as a fallback for browsers that stall the watch.
 * `onError` fires whenever the browser reports a geolocation error.
 */
export function useLocationBroadcast(
  enabled: boolean,
  onPos: (p: { lat: number; lng: number }) => void,
  intervalMs = 15000,
  onError?: (message: string) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onError?.("Location is not supported on this device");
      return;
    }

    let cancelled = false;
    let lastEmit = 0;

    const emit = (lat: number, lng: number) => {
      if (cancelled) return;
      lastEmit = Date.now();
      onPos({ lat, lng });
    };

    const handleError = (e: GeolocationPositionError) => {
      if (cancelled) return;
      const msg =
        e.code === 1
          ? "Location permission denied. Enable it in browser/phone settings."
          : e.code === 2
            ? "Location unavailable. Check GPS / network signal."
            : e.code === 3
              ? "Location timed out."
              : e.message || "Location error";
      onError?.(msg);
    };

    // Kick off an immediate position so the DB has a value right away.
    navigator.geolocation.getCurrentPosition(
      (p) => emit(p.coords.latitude, p.coords.longitude),
      handleError,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    const watchId = navigator.geolocation.watchPosition(
      (p) => emit(p.coords.latitude, p.coords.longitude),
      handleError,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    );

    // Fallback heartbeat — if the watch has been quiet longer than the
    // interval, force a fresh reading.
    const heartbeat = window.setInterval(() => {
      if (Date.now() - lastEmit < intervalMs) return;
      navigator.geolocation.getCurrentPosition(
        (p) => emit(p.coords.latitude, p.coords.longitude),
        handleError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
      );
    }, intervalMs);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
    };
  }, [enabled, intervalMs, onPos, onError]);
}
