import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Waypoints, Plus, Trash2 } from "lucide-react";
import { listRoutes, createRoute, type RouteStopInput } from "@/lib/routes.functions";
import { adminListAssignableDrivers } from "@/lib/dispatchAdmin.functions";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dispatch/routes/")({
  component: RoutesView,
});

type RouteRow = Awaited<ReturnType<typeof listRoutes>>[number];
type DriverOpt = { id: string; name: string };

type DraftStop = {
  key: string;
  kind: "pickup" | "dropoff" | "stop";
  leg: "outbound" | "return";
  passenger_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  assigned: "bg-primary/15 text-primary",
  in_progress: "bg-sky-500/15 text-sky-600",
  completed: "bg-emerald-500/15 text-emerald-600",
};

function newStop(kind: DraftStop["kind"] = "pickup"): DraftStop {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    leg: "outbound",
    passenger_name: "",
    address: "",
    lat: null,
    lng: null,
  };
}

function RoutesView() {
  const load = useServerFn(listRoutes);
  const create = useServerFn(createRoute);
  const loadDrivers = useServerFn(adminListAssignableDrivers);

  const [rows, setRows] = useState<RouteRow[] | null>(null);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [driverId, setDriverId] = useState("");
  const [stops, setStops] = useState<DraftStop[]>([newStop("pickup"), newStop("dropoff")]);

  const refresh = useCallback(async () => {
    try {
      const data = await load({ data: {} });
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load routes");
      setRows([]);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    loadDrivers({ data: {} })
      .then((d) =>
        setDrivers(
          (d as Array<{ id: string; name?: string | null }>).map((x) => ({
            id: x.id,
            name: x.name ?? "Driver",
          })),
        ),
      )
      .catch(() => setDrivers([]));
  }, [refresh, loadDrivers]);

  function patchStop(key: string, patch: Partial<DraftStop>) {
    setStops((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function submit() {
    const clean = stops.filter((s) => s.address.trim());
    if (clean.length < 2) {
      toast.error("Add at least a pickup and a drop-off");
      return;
    }
    setSaving(true);
    try {
      const payload: RouteStopInput[] = clean.map((s) => ({
        kind: s.kind,
        leg: s.leg,
        passenger_name: s.passenger_name.trim() || null,
        address: s.address.trim(),
        lat: s.lat,
        lng: s.lng,
      }));
      const res = await create({
        data: {
          name: name.trim() || null,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          driver_id: driverId || null,
          stops: payload,
        },
      });
      toast.success(`Route created with ${res.stops.length} stops`);
      setShowBuilder(false);
      setName("");
      setScheduledAt("");
      setDriverId("");
      setStops([newStop("pickup"), newStop("dropoff")]);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create route");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">Routes</h1>
        <Button size="sm" className="rounded-full" onClick={() => setShowBuilder((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" /> {showBuilder ? "Close builder" : "New route"}
        </Button>
      </div>

      {showBuilder && (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="Route name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="">Leave unassigned</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            {stops.map((s, i) => (
              <div key={s.key} className="rounded-xl border border-border p-2">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">#{i + 1}</span>
                  <select
                    value={s.kind}
                    onChange={(e) => patchStop(s.key, { kind: e.target.value as DraftStop["kind"] })}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                  >
                    <option value="pickup">Pickup</option>
                    <option value="dropoff">Drop-off</option>
                    <option value="stop">Stop</option>
                  </select>
                  <select
                    value={s.leg}
                    onChange={(e) => patchStop(s.key, { leg: e.target.value as DraftStop["leg"] })}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                  >
                    <option value="outbound">Outbound</option>
                    <option value="return">Return</option>
                  </select>
                  <Input
                    className="h-8 flex-1 text-xs"
                    placeholder="Passenger name"
                    value={s.passenger_name}
                    onChange={(e) => patchStop(s.key, { passenger_name: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setStops((prev) => prev.filter((x) => x.key !== s.key))}
                    className="rounded-md p-1 text-red-600 hover:bg-red-500/10"
                    aria-label="Remove stop"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <AddressAutocomplete
                  value={s.address}
                  onChange={(v) => patchStop(s.key, { address: v, lat: null, lng: null })}
                  onResolve={(p) =>
                    patchStop(s.key, { address: p.address, lat: p.lat, lng: p.lng })
                  }
                  placeholder="Street address"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="rounded-full"
              onClick={() => setStops((prev) => [...prev, newStop("pickup")])}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add stop
            </Button>
            <Button size="sm" className="rounded-full" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Create route
            </Button>
            <span className="text-xs text-muted-foreground">
              Stops are auto-sequenced (pickup before drop-off, return leg after outbound).
            </span>
          </div>
        </div>
      )}

      {rows === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
          No routes yet. Build one here, or select multiple requests on the board.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.id}
              to="/dispatch/routes/$routeId"
              params={{ routeId: r.id }}
              className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4 hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Waypoints className="h-4 w-4 text-primary" />
                  <span className="truncate font-medium">{r.name || `Route ${r.id.slice(0, 8)}`}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {r.stops_done}/{r.stop_count} stops done
                  {r.scheduled_at ? ` · ${new Date(r.scheduled_at).toLocaleString()}` : ""}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  STATUS_STYLE[String(r.status)] ?? "bg-muted text-muted-foreground",
                )}
              >
                {String(r.status).replace(/_/g, " ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
