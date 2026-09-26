import { useMemo } from "react";
import { DriverFleetMap } from "@/components/nemt/useClientMap";
import { Navigation, Map as MapIcon } from "lucide-react";
import { decodePolyline } from "@/lib/navigation/adapter";
import { useLiveEta } from "@/lib/useLiveEta";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export type LatLng = { lat: number; lng: number };

type Props = {
  /** Driver's live GPS position (null until the first fix). */
  driver?: LatLng | null;
  /** The stop the driver is currently heading to. */
  destination?: LatLng | null;
  destinationLabel?: string;
  destinationKind?: "pickup" | "dropoff" | "stop";
  /** Opens Google Maps with driving directions to this stop. */
  onStartNavigation?: () => void;
  /** Opens the full route preview for this stop. */
  onRouteOverview?: () => void;
};

/**
 * Route preview for the driver's current stop: the driving line, the live
 * driver pin and an arrival time that keeps up with the vehicle. Driving
 * directions open in Google Maps from the one clear button below the map.
 */
export function ActiveTripMap({
  driver,
  destination,
  destinationLabel,
  destinationKind = "pickup",
  onStartNavigation,
  onRouteOverview,
}: Props) {
  const { theme } = useTheme();
  const eta = useLiveEta(driver ?? null, destination ?? null, true);
  const routePath = useMemo(
    () =>
      eta.polyline
        ? decodePolyline(eta.polyline).map(({ lat, lng }) => [lat, lng] as [number, number])
        : [],
    [eta.polyline],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="relative isolate h-56 w-full sm:h-64">
        <DriverFleetMap
          dark={theme === "dark"}
          center={[
            destination?.lat ?? driver?.lat ?? 38.83,
            destination?.lng ?? driver?.lng ?? -104.82,
          ]}
          routePath={routePath}
          markers={[
            ...(driver ? [{ id: "driver", ...driver, status: "busy" as const, label: "You" }] : []),
            ...(destination
              ? [
                  {
                    id: "destination",
                    ...destination,
                    status: "available" as const,
                    label: destinationLabel ?? "Next stop",
                  },
                ]
              : []),
          ]}
        />
        {!driver && (
          <div className="absolute inset-x-0 bottom-6 z-[500] bg-surface/90 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
            Waiting for your GPS location…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {destinationKind === "dropoff"
              ? "To drop-off"
              : destinationKind === "stop"
                ? "To next stop"
                : "To pickup"}
          </div>
          <div className="text-sm font-semibold">{eta.label}</div>
          {destinationLabel && (
            <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
              {destinationLabel}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRouteOverview && (
            <Button
              variant="ghost"
              className="h-11 rounded-full text-sm font-semibold"
              onClick={onRouteOverview}
            >
              <MapIcon className="mr-2 h-4 w-4" /> Route Overview
            </Button>
          )}
          {onStartNavigation && (
            <Button
              className="h-11 rounded-full px-5 text-sm font-semibold"
              onClick={onStartNavigation}
            >
              <Navigation className="mr-2 h-4 w-4" /> Start Navigation
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
