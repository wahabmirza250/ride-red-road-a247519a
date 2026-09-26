import { useMemo, useState } from "react";
import { X, Navigation, Navigation2, Map as MapIcon } from "lucide-react";
import { DriverFleetMap } from "@/components/nemt/useClientMap";
import { decodePolyline } from "@/lib/navigation/adapter";
import { useLiveEta } from "@/lib/useLiveEta";
import { openNavigation } from "@/lib/mapsDeepLink";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export type LatLng = { lat: number; lng: number };

type Props = {
  open: boolean;
  driver: LatLng | null;
  destination: LatLng;
  destinationLabel: string;
  destinationKind: "pickup" | "dropoff";
  /** Primary trip action shown at the bottom (e.g. "Arrived at Pickup"). */
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
};

/**
 * Full-screen route preview for the stop the driver is heading to.
 *
 * NEMT Solutions keeps the route, the passenger record, the times, the mileage and the
 * signatures. Driving directions open in Google Maps for the stop that is
 * current at that moment, so completing a stop and tapping Start Navigation
 * again opens directions to the new stop.
 */
export function InAppNavigation({
  open,
  driver,
  destination,
  destinationLabel,
  destinationKind,
  actionLabel,
  onAction,
  onClose,
}: Props) {
  const [follow, setFollow] = useState(true);
  const { theme } = useTheme();
  const eta = useLiveEta(driver, destination, open);
  const routePath = useMemo(
    () =>
      eta.polyline
        ? decodePolyline(eta.polyline).map(({ lat, lng }) => [lat, lng] as [number, number])
        : [],
    [eta.polyline],
  );
  const focus = useMemo(
    () => (follow && driver ? { ...driver, zoom: 15 } : null),
    [follow, driver?.lat, driver?.lng],
  );
  if (!open) return null;

  function routeOverview() {
    setFollow(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative isolate min-h-0 flex-1">
        <div className="absolute inset-0 z-0">
          <DriverFleetMap
            dark={theme === "dark"}
            center={[destination.lat, destination.lng]}
            routePath={routePath}
            focus={focus}
            onDragStart={() => setFollow(false)}
            markers={[
              ...(driver
                ? [{ id: "driver", ...driver, status: "busy" as const, label: "You" }]
                : []),
              { id: "destination", ...destination, status: "available", label: destinationLabel },
            ]}
          />
        </div>

        <div className="pointer-events-none absolute z-10 inset-x-3 top-3 space-y-2">
          <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface/95 p-4 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {destinationKind === "dropoff" ? "To drop-off" : "To pickup"}
              </div>
              <div className="truncate text-sm font-semibold">{destinationLabel}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{eta.label}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close route preview"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {!driver && (
            <div className="pointer-events-auto rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600">
              Waiting for your location — the route appears as soon as your position is found.
            </div>
          )}
        </div>

        <div className="absolute z-10 bottom-4 right-4 flex flex-col gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full shadow"
            onClick={routeOverview}
          >
            <MapIcon className="mr-1.5 h-4 w-4" /> Route Overview
          </Button>
          <Button
            size="sm"
            variant={follow ? "default" : "secondary"}
            className="rounded-full shadow"
            onClick={() => setFollow(true)}
          >
            <Navigation2 className="mr-1.5 h-4 w-4" /> Re-center
          </Button>
        </div>
      </div>

      <div className="driver-nav-offset space-y-3 border-t border-border bg-surface px-4 pt-3">
        <Button
          className="h-14 w-full rounded-2xl text-base font-semibold"
          onClick={() => openNavigation({ ...destination, address: destinationLabel })}
        >
          <Navigation className="mr-2 h-5 w-5" /> Start Navigation
        </Button>
        <Button
          variant="outline"
          className="h-12 w-full rounded-2xl text-sm font-semibold"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
