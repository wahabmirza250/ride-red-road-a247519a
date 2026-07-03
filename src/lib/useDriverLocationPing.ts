import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * While a driver is signed in, periodically push their GPS to the drivers row
 * so the admin dashboard map shows a live pin. Runs client-side only.
 */
export function useDriverLocationPing(intervalMs = 15000) {
  const { user, isDriver } = useAuth();

  useEffect(() => {
    if (!user || !isDriver) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;

    const push = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          const { latitude, longitude } = pos.coords;
          await supabase
            .from("drivers")
            .update({
              current_lat: latitude,
              current_lng: longitude,
              last_location_update: new Date().toISOString(),
            })
            .eq("user_id", user.id);
        },
        () => {
          /* ignore permission/errors — silent */
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
      );
    };

    push();
    const id = window.setInterval(push, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user, isDriver, intervalMs]);
}
