import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDispatchBoard } from "@/lib/dispatchApp.functions";
import { supabase } from "@/lib/supabaseBrowser";
import { DriverFleetMap } from "@/components/nemt/useClientMap";
import { StatusPill } from "@/components/nemt/StatusPill";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { locationState } from "@/lib/operationStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LIVE_STATUSES = [
  "scheduled",
  "assigned",
  "driver_en_route_to_pickup",
  "arrived_at_pickup",
  "in_progress",
];
const EMPTY_ROUTE: [number, number][] = [];
export function TrackRidesPanel() {
  const loadBoard = useServerFn(getDispatchBoard);
  const { theme } = useTheme();
  const isDemo = useAuth().user?.app_metadata?.is_demo === true;
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const data = useQuery({
    queryKey: ["dispatch_tracking"],
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const [board, result, requests] = await Promise.all([
        loadBoard({}),
        supabase
          .from("trips")
          .select(
            "id,status,driver_id,scheduled_pickup_time,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,passengers(first_name,last_name)",
          )
          .in("status", LIVE_STATUSES as any)
          .order("scheduled_pickup_time")
          .limit(100),
        supabase
          .from("ride_requests")
          .select(
            "id,status,driver_id,requested_pickup_time,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,contact_name",
          )
          .eq("status", "pending")
          .order("requested_pickup_time")
          .limit(100),
      ]);
      if (result.error || requests.error) throw new Error("Could not load rides");
      return {
        drivers: board.drivers,
        trips: (result.data ?? [])
          .map((t: any) => ({
            ...t,
            passengerName:
              [t.passengers?.first_name, t.passengers?.last_name].filter(Boolean).join(" ") ||
              "Passenger",
          }))
          .concat(
            (requests.data ?? []).map((r: any) => ({
              ...r,
              scheduled_pickup_time: r.requested_pickup_time,
              passengerName: r.contact_name || "Passenger",
            })),
          ),
      };
    },
  });
  const trips = data.data?.trips ?? [];
  const visible = trips.filter((t) =>
    [
      t.passengerName,
      t.pickup_address,
      t.dropoff_address,
      data.data?.drivers.find((d) => d.id === t.driver_id)?.name,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const current =
    visible.find((t) => t.id === selected) ??
    visible.find((t) => t.status === "in_progress") ??
    visible[0];
  const driver = data.data?.drivers.find((d) => d.id === current?.driver_id);
  const gpsState = driver
    ? locationState({
        current_lat: driver.lat,
        current_lng: driver.lng,
        last_location_at: driver.last_location_at,
        status: driver.status,
      })
    : "No driver";
  const markers = [
    ...(driver?.lat != null && driver?.lng != null
      ? [
          {
            id: "driver",
            lat: driver.lat,
            lng: driver.lng,
            status: gpsState === "Live" ? ("busy" as const) : ("offline" as const),
            label: driver.name,
          },
        ]
      : []),
    ...(current?.pickup_lat != null && current?.pickup_lng != null
      ? [
          {
            id: "pickup",
            lat: current.pickup_lat,
            lng: current.pickup_lng,
            status: "available" as const,
            label: "Pickup",
          },
        ]
      : []),
    ...(current?.dropoff_lat != null && current?.dropoff_lng != null
      ? [
          {
            id: "dropoff",
            lat: current.dropoff_lat,
            lng: current.dropoff_lng,
            status: "busy" as const,
            label: "Drop-off",
          },
        ]
      : []),
  ];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Track rides</h2>
          <p className="text-sm text-muted-foreground">
            Select a ride to see its driver, pickup, destination, and progress. Refreshes every 15
            seconds.
          </p>
        </div>
        <Button variant="outline" onClick={() => void data.refetch()} disabled={data.isFetching}>
          Refresh rides
        </Button>
      </div>
      <Input
        aria-label="Search rides to track"
        placeholder="Search passenger, driver, or address"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {data.isError ? (
        <p role="alert">Could not refresh tracking. Use Refresh rides to try again.</p>
      ) : data.isLoading ? (
        <p>Loading rides…</p>
      ) : !visible.length ? (
        <p className="rounded-xl border border-border p-5">
          {search
            ? "No matching rides."
            : "No active or upcoming rides yet. Create a ride, then assign a driver from Plan rides."}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
          <div className="max-h-[38rem] space-y-2 overflow-auto">
            {visible.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                aria-pressed={current?.id === t.id}
                className={`w-full rounded-xl border p-4 text-left ${current?.id === t.id ? "border-primary bg-primary/10" : "border-border bg-surface"}`}
              >
                <span className="font-semibold">{t.passengerName}</span>
                <div className="my-2">
                  <StatusPill status={t.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.pickup_address} → {t.dropoff_address}
                </p>
                <p className="mt-2 text-xs">
                  {data.data?.drivers.find((d) => d.id === t.driver_id)?.name ?? "Unassigned"}
                </p>
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="relative isolate h-72 sm:h-96">
              <DriverFleetMap
                dark={theme === "dark"}
                center={[markers[0]?.lat ?? 38.83, markers[0]?.lng ?? -104.82]}
                markers={markers}
                routePath={EMPTY_ROUTE}
              />
            </div>
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{current.passengerName}</h3>
                <StatusPill status={current.status} />
              </div>
              <p className="text-sm">
                Driver: {driver?.name ?? "Not assigned"} ·{" "}
                {isDemo
                  ? "Sample location"
                  : gpsState === "Live"
                    ? "Live location"
                    : "Last known location"}
              </p>
              {!isDemo && gpsState !== "Live" && (
                <p className="text-xs text-muted-foreground">
                  Current GPS is not available. The map may show the driver’s last reported
                  position.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Pickup</p>
                  <p className="text-sm">{current.pickup_address}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Drop-off</p>
                  <p className="text-sm">{current.dropoff_address}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Scheduled pickup:{" "}
                {current.scheduled_pickup_time
                  ? new Date(current.scheduled_pickup_time).toLocaleString()
                  : "ASAP"}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
