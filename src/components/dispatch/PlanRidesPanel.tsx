import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, CalendarClock, Clock, Search } from "lucide-react";
import { getPlannableRides } from "@/lib/dispatchApp.functions";
import {
  adminReassignDriver,
  adminListAssignableDrivers,
  rescheduleRide,
} from "@/lib/dispatchAdmin.functions";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Ride = Awaited<ReturnType<typeof getPlannableRides>>[number];

function dayKey(iso: string | null) {
  if (!iso) return "Unscheduled / ASAP";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlanRidesPanel() {
  const load = useServerFn(getPlannableRides);
  const loadDrivers = useServerFn(adminListAssignableDrivers);
  const assign = useServerFn(adminReassignDriver);
  const reschedule = useServerFn(rescheduleRide);

  const [rides, setRides] = useState<Ride[] | null>(null);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await load({
        data: {
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        },
      });
      setRides(res as Ride[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load planned rides");
      setRides([]);
    }
  }, [load, from, to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    loadDrivers(undefined)
      .then((d) =>
        setDrivers(
          (d as Array<{ id: string; name?: string | null; status: string }>).map((x) => ({
            id: x.id,
            name: x.name ?? "Driver",
            status: String(x.status),
          })),
        ),
      )
      .catch(() => setDrivers([]));
  }, [loadDrivers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rides ?? [];
    return (rides ?? []).filter((r) =>
      [r.contact_name, r.pickup_address, r.dropoff_address, r.driver_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rides, query]);

  const unassignedCount = useMemo(
    () => filtered.filter((r) => !r.driver_id).length,
    [filtered],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Ride[]>();
    filtered.forEach((r) => {
      const k = dayKey(r.requested_pickup_time);
      map.set(k, [...(map.get(k) ?? []), r]);
    });
    return Array.from(map.entries());
  }, [filtered]);

  async function doAssign(rideId: string, driverId: string) {
    setBusy(rideId);
    try {
      await assign({ data: { request_id: rideId, driver_id: driverId } });
      toast.success("Driver assigned");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusy(null);
    }
  }

  async function doReschedule(rideId: string, local: string) {
    if (!local) return;
    setBusy(rideId);
    try {
      await reschedule({
        data: { request_id: rideId, requested_pickup_time: new Date(local).toISOString() },
      });
      toast.success("Pickup time updated");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reschedule");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-semibold">Plan rides</h1>
          <p className="text-sm text-muted-foreground">
            Assign drivers ahead of time and adjust upcoming pickup times.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search passenger, address, driver"
              className="h-9 w-56 pl-7"
            />
          </div>
          <Input
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-auto"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-auto"
          />
        </div>
      </div>

      {rides !== null && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border bg-surface px-3 py-1 font-medium">
            {filtered.length} planned {filtered.length === 1 ? "ride" : "rides"}
          </span>
          <span
            className={cn(
              "rounded-full border px-3 py-1 font-medium",
              unassignedCount > 0
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                : "border-border bg-surface text-muted-foreground",
            )}
          >
            {unassignedCount} unassigned
          </span>
        </div>
      )}

      {rides === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
          No rides to plan in this window.
        </p>
      ) : (
        grouped.map(([day, list]) => (
          <div key={day} className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" /> {day}
              <span className="text-xs font-normal text-muted-foreground">({list.length})</span>
            </div>
            <div className="space-y-3">
              {list.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    "rounded-xl border border-border p-3",
                    !r.driver_id && "border-l-4 border-l-amber-500",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{r.contact_name || "Passenger"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.pickup_address} → {r.dropoff_address}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {r.driver_name ? `Assigned · ${r.driver_name}` : "Unassigned"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      defaultValue=""
                      disabled={busy === r.id}
                      aria-label="Assign driver"
                      onChange={(e) => {
                        const v = e.target.value;
                        e.target.value = "";
                        if (v) void doAssign(r.id, v);
                      }}
                      className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">{r.driver_id ? "Change driver…" : "Assign driver…"}</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {d.status}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <input
                        type="datetime-local"
                        aria-label="Pickup time"
                        defaultValue={toLocalInput(r.requested_pickup_time)}
                        disabled={busy === r.id}
                        onChange={(e) => void doReschedule(r.id, e.target.value)}
                        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                      />
                    </label>
                    {busy === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
