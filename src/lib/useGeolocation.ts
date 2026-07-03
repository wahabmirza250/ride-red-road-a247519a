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

// Continuously ping the driver's location while `enabled` is true.
export function useLocationBroadcast(
  enabled: boolean,
  onPos: (p: { lat: number; lng: number }) => void,
  intervalMs = 5000,
) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    const push = () =>
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (!cancelled) onPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
      );
    push();
    const id = window.setInterval(push, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, intervalMs, onPos]);
}
