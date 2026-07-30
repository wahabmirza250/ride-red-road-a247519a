import { createFileRoute } from "@tanstack/react-router";
import { GasReceiptsPanel } from "@/components/expenses/GasReceiptsPanel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Phone, Sparkles, AlertTriangle, Waypoints } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { GoogleFleetMap, type FleetMarker } from "@/components/nemt/GoogleFleetMap";
import { AddRideDialog } from "@/components/nemt/AddRideDialog";

import {
  getDispatchBoard,
  type DispatchDriver,
  type DispatchRequest,
} from "@/lib/dispatchApp.functions";
import { adminReassignDriver, adminCancelTrip } from "@/lib/dispatchAdmin.functions";
import { buildRouteFromRequests } from "@/lib/routes.functions";
import { setAutoAssign } from "@/lib/settings.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dispatch/")({
  component: DispatchBoard,
});

const DEFAULT_CENTER: [number, number] = [39.7392, -104.9903];

const VEHICLE_LABEL: Record<string, string> = {
  ambulatory: "Ambulatory",
  wheelchair_van: "Wheelchair van",
  stretcher_van: "Stretcher van",
  ground_ambulance: "Ambulance",
  taxi: "Taxi",
};

const FLAG_LABEL: Record<string, string> = {
  waiting_too_long: "Unassigned too long",
  pickup_imminent_unassigned: "Pickup soon · no driver",
  running_late: "Running late",
  driver_not_moving: "Driver not moving",
};

function urgencyStyle(u: DispatchRequest["urgency"]) {
  switch (u) {
    case "overdue":
      return "border-l-4 border-l-red-500 bg-red-500/5";
    case "soon":
      return "border-l-4 border-l-amber-500 bg-amber-500/5";
    case "asap":
      return "border-l-4 border-l-primary/60";
    default:
      return "border-l-4 border-l-transparent";
  }
}

function activityDot(a: DispatchDriver["activity"]) {
  return a === "driving"
    ? "bg-sky-500"
    : a === "idle"
      ? "bg-emerald-500"
      : a === "stale"
        ? "bg-amber-500"
        : "bg-gray-400";
}

type Board = Awaited<ReturnType<typeof getDispatchBoard>>;

function DispatchBoard() {
  const load = useServerFn(getDispatchBoard);
  const reassign = useServerFn(adminReassignDriver);
  const cancelTrip = useServerFn(adminCancelTrip);
  const buildRoute = useServerFn(buildRouteFromRequests);
  const toggleAuto = useServerFn(setAutoAssign);

  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; id?: string } | null>(
    null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [roundTrip, setRoundTrip] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBoard(await load({}));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load board");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const ch = supabase
      .channel("dispatch-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () =>
        refresh(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => refresh())
      .subscribe();
    const t = setInterval(() => void refresh(), 20_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [refresh]);

  const markers: FleetMarker[] = useMemo(
    () =>
      (board?.drivers ?? [])
        .filter((d) => d.lat != null && d.lng != null)
        .map((d) => ({
          id: d.id,
          lat: d.lat as number,
          lng: d.lng as number,
          status:
            d.activity === "driving"
              ? "busy"
              : d.activity === "idle"
                ? "available"
                : "offline",
          label: `${d.name} · ${d.activity}`,
        })),
    [board],
  );

  async function assign(requestId: string, driverId: string) {
    if (!driverId) return;
    setBusy(requestId);
    try {
      await reassign({ data: { request_id: requestId, driver_id: driverId } });
      toast.success("Driver assigned");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(requestId: string) {
    if (!window.confirm("Cancel this ride? The driver will be notified.")) return;
    setBusy(requestId);
    try {
      await cancelTrip({ data: { request_id: requestId } });
      toast.success("Ride cancelled");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }

  async function combine() {
    if (selected.length < 1) return;
    setBuilding(true);
    try {
      const r = await buildRoute({
        data: { request_ids: selected, round_trip_request_ids: roundTrip },
      });
      toast.success(`Route built with ${r.stops.length} stops`);
      setSelected([]);
      setRoundTrip([]);
      window.location.assign(`/dispatch/routes/${r.route.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build route");
    } finally {
      setBuilding(false);
    }
  }

  if (!board) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const idle = board.drivers.filter((d) => d.activity === "idle").length;
  const driving = board.drivers.filter((d) => d.activity === "driving").length;
  const unassigned = board.requests.filter((r) => !r.driver_id).length;

  const driverOptions = board.drivers.map((d) => ({ id: d.id, name: d.name, activity: d.activity }));
  const selectedDriver = board.drivers.find((d) => d.id === focus?.id) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispatch board</h1>
          <p className="text-sm text-muted-foreground">
            Live requests and driver activity. Updates automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddRideDialog
            drivers={driverOptions}
            preselectedDriverId={selectedDriver?.id ?? null}
            onCreated={() => void refresh()}
          />
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2">
            <span className="text-xs font-medium">Auto-assign</span>
            <button
              disabled={!board.viewer.isAdmin}
              onClick={async () => {
                try {
                  await toggleAuto({ data: { enabled: !board.autoAssign } });
                  await refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not update");
                }
              }}
              className={cn(
                "relative h-6 w-11 rounded-full transition",
                board.autoAssign ? "bg-primary" : "bg-muted",
                !board.viewer.isAdmin && "cursor-not-allowed opacity-60",
              )}
              title={board.viewer.isAdmin ? "Toggle auto-assign" : "Admin only"}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                  board.autoAssign ? "left-[22px]" : "left-0.5",
                )}
              />
            </button>
            <span className="text-xs text-muted-foreground">
              {board.autoAssign ? "ON" : "OFF — manual"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Idle drivers", value: idle },
          { label: "Driving", value: driving },
          { label: "Unassigned", value: unassigned },
          { label: "Active requests", value: board.requests.length },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Map + driver list side by side: one glance for "where is everyone" */}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="h-[420px] overflow-hidden rounded-2xl border border-border">
          <GoogleFleetMap
            center={DEFAULT_CENTER}
            markers={markers}
            focus={focus}
            onMarkerClick={(id) => {
              const d = board.drivers.find((x) => x.id === id);
              if (d?.lat != null && d?.lng != null)
                setFocus({ lat: d.lat, lng: d.lng, zoom: 14, id });
            }}
          />
        </div>

        <div className="flex max-h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Drivers ({board.drivers.length})</span>
            {selectedDriver && (
              <button
                onClick={() => setFocus(null)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {board.drivers.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  if (d.lat != null && d.lng != null) {
                    setFocus({ lat: d.lat, lng: d.lng, zoom: 15, id: d.id });
                  } else {
                    setFocus({ lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1], id: d.id });
                    toast.info(`${d.name} has no live GPS position yet`);
                  }
                }}
                className={cn(
                  "flex w-full items-center justify-between px-4 py-3 text-left text-sm transition",
                  focus?.id === d.id ? "bg-primary/10" : "hover:bg-muted/50",
                  d.lat == null && "opacity-70",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", activityDot(d.activity))} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.activity}
                      {d.vehicle_type ? ` · ${VEHICLE_LABEL[d.vehicle_type] ?? d.vehicle_type}` : ""}
                      {d.vehicle_label ? ` · ${d.vehicle_label}` : ""}
                    </div>
                  </div>
                </div>
                {d.stale && d.activity !== "offline" && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                    no GPS
                  </span>
                )}
              </button>
            ))}
            {board.drivers.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No drivers yet.</div>
            )}
          </div>
          {selectedDriver && (
            <div className="border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{selectedDriver.name}</span> selected —
              use “Assign to {selectedDriver.name}” on any request below.
            </div>
          )}
        </div>
      </div>


      {/* Requests */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">Incoming requests</span>
          {selected.length > 0 && (
            <button
              onClick={combine}
              disabled={building}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {building ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Waypoints className="h-3.5 w-3.5" />
              )}
              Combine {selected.length} into a route
            </button>
          )}
        </div>

        <div className="divide-y divide-border">
          {board.requests.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nothing in the queue.
            </div>
          )}
          {board.requests.map((r) => {
            const checked = selected.includes(r.id);
            return (
              <div key={r.id} className={cn("py-3 pl-3", urgencyStyle(r.urgency))}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id),
                          )
                        }
                        className="h-4 w-4 rounded border-border"
                        title="Select for batch route"
                      />
                      <span className="font-semibold">{r.passenger_name}</span>
                      <span className="uppercase tracking-widest text-muted-foreground">
                        {r.status}
                      </span>
                      {r.vehicle_type && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          {VEHICLE_LABEL[r.vehicle_type] ?? r.vehicle_type}
                        </span>
                      )}
                      {r.minutes_to_pickup != null && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-semibold",
                            r.minutes_to_pickup < 0
                              ? "bg-red-500 text-white"
                              : r.minutes_to_pickup <= 20
                                ? "bg-amber-500/20 text-amber-700"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {r.minutes_to_pickup < 0
                            ? `${Math.abs(r.minutes_to_pickup)}m late`
                            : `in ${r.minutes_to_pickup}m`}
                        </span>
                      )}
                      {r.flags.map((f) => (
                        <span
                          key={f}
                          className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-semibold text-red-600"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {FLAG_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 truncate text-sm">↑ {r.pickup_address}</div>
                    <div className="truncate text-sm">↓ {r.dropoff_address}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>waiting {Math.floor(r.waiting_ms / 60000)}m</span>
                      {r.passenger_phone && (
                        <a
                          href={`tel:${r.passenger_phone.replace(/[^+\d]/g, "")}`}
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {r.passenger_phone}
                        </a>
                      )}
                      {checked && (
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={roundTrip.includes(r.id)}
                            onChange={(e) =>
                              setRoundTrip((s) =>
                                e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id),
                              )
                            }
                            className="h-3.5 w-3.5 rounded border-border"
                          />
                          round trip
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {!r.driver_id && r.suggested_driver_id && (
                      <button
                        onClick={() => assign(r.id, r.suggested_driver_id as string)}
                        disabled={busy === r.id}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary disabled:opacity-50"
                        title="Suggestion only — you always choose"
                      >
                        <Sparkles className="h-3 w-3" />
                        {r.suggested_driver_name} · {r.suggested_driver_km}km
                      </button>
                    )}
                    <select
                      className="max-w-[190px] rounded-md border border-border bg-background px-2 py-1 text-xs"
                      /* Always render as an action picker (never bound to the
                         current driver) so re-picking the same driver still
                         fires onChange and re-sends/refreshes the offer. */
                      value=""
                      disabled={busy === r.id}
                      onChange={(e) => {
                        assign(r.id, e.target.value);
                        e.target.value = "";
                      }}
                    >
                      <option value="">
                        {r.driver_id ? `Change driver… (${r.driver_name ?? "assigned"})` : "Assign driver…"}
                      </option>

                      {board.drivers.map((d) => {
                        const match = !r.vehicle_type || d.vehicle_type === r.vehicle_type;
                        return (
                          <option key={d.id} value={d.id}>
                            {match ? "✓ " : "· "}
                            {d.name} · {d.activity}
                            {d.vehicle_type ? ` · ${VEHICLE_LABEL[d.vehicle_type] ?? d.vehicle_type}` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={busy === r.id}
                      className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Cancel ride
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drivers */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-sm font-semibold">Drivers ({board.drivers.length})</div>
        <div className="divide-y divide-border">
          {board.drivers.map((d) => (
            <button
              key={d.id}
              disabled={d.lat == null}
              onClick={() =>
                d.lat != null && d.lng != null && setFocus({ lat: d.lat, lng: d.lng, zoom: 15, id: d.id })
              }
              className={cn(
                "flex w-full items-center justify-between py-3 text-left text-sm",
                d.lat == null ? "cursor-not-allowed opacity-60" : "hover:bg-muted/50",
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("h-2.5 w-2.5 rounded-full", activityDot(d.activity))} />
                <div>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.activity}
                    {d.vehicle_type ? ` · ${VEHICLE_LABEL[d.vehicle_type] ?? d.vehicle_type}` : ""}
                    {d.vehicle_label ? ` · ${d.vehicle_label}` : ""}
                  </div>
                </div>
              </div>
              {d.stale && d.activity !== "offline" && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                  no GPS update
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <GasReceiptsPanel />

      {board.dispatchPhone && (
        <p className="pb-2 text-center text-xs text-muted-foreground">
          Passenger fallback line: {board.dispatchPhone}
        </p>
      )}
    </div>
  );
}
