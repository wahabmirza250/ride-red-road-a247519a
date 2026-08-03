import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, ExternalLink, Wand2, Check,
} from "lucide-react";
import {
  getRoute,
  reorderRouteStops,
  autoSequenceRoute,
  addRouteStop,
  removeRouteStop,
  assignRouteDriver,
  completeRouteStop,
} from "@/lib/routes.functions";
import { adminListAssignableDrivers } from "@/lib/dispatchAdmin.functions";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dispatch/routes/$routeId")({
  component: RouteDetail,
});

type Loaded = Awaited<ReturnType<typeof getRoute>>;

const KIND_STYLE: Record<string, string> = {
  pickup: "bg-emerald-500/15 text-emerald-600",
  dropoff: "bg-red-500/15 text-red-600",
  stop: "bg-primary/15 text-primary",
};

function RouteDetail() {
  const { routeId } = Route.useParams();
  const load = useServerFn(getRoute);
  const reorder = useServerFn(reorderRouteStops);
  const autoSeq = useServerFn(autoSequenceRoute);
  const addStop = useServerFn(addRouteStop);
  const removeStop = useServerFn(removeRouteStop);
  const assign = useServerFn(assignRouteDriver);
  const complete = useServerFn(completeRouteStop);
  const loadDrivers = useServerFn(adminListAssignableDrivers);

  const [data, setData] = useState<Loaded | null>(null);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [newAddr, setNewAddr] = useState("");
  const [newCoords, setNewCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [newKind, setNewKind] = useState<"pickup" | "dropoff" | "stop">("stop");
  const [newLeg, setNewLeg] = useState<"outbound" | "return">("outbound");
  const [newPax, setNewPax] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await load({ data: { route_id: routeId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load route");
    }
  }, [load, routeId]);

  useEffect(() => {
    void refresh();
    loadDrivers(undefined)
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

  async function run<T>(fn: () => Promise<T>, okMsg?: string) {
    setBusy(true);
    try {
      const res = (await fn()) as Loaded;
      if (res && typeof res === "object" && "stops" in res) setData(res);
      else await refresh();
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    if (!data) return;
    const ids = data.stops.map((s) => s.id as string);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => reorder({ data: { route_id: routeId, ordered_stop_ids: ids } }));
  }

  if (!data) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const r = data.route;

  return (
    <div className="space-y-4">
      <Link to="/dispatch/routes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All routes
      </Link>

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-lg font-semibold">
              {r.name || `Route ${String(r.id).slice(0, 8)}`}
            </h1>
            <div className="text-xs text-muted-foreground">
              {String(r.status).replace(/_/g, " ")}
              {r.scheduled_at ? ` · ${new Date(r.scheduled_at).toLocaleString()}` : ""}
              {r.driver_name ? ` · ${r.driver_name}` : " · unassigned"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={r.driver_id ?? ""}
              disabled={busy}
              onChange={(e) =>
                run(
                  () => assign({ data: { route_id: routeId, driver_id: e.target.value || null } }),
                  "Driver updated",
                )
              }
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="">Unassigned</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={busy}
              onClick={() => run(() => autoSeq({ data: { route_id: routeId } }), "Re-sequenced")}
            >
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Auto-sequence
            </Button>
            {data.mapsUrl && (
              <a
                href={data.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground"
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Google Maps route
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-sm font-semibold">Stops ({data.stops.length})</div>
        <div className="space-y-2">
          {data.stops.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                "flex items-start gap-2 rounded-xl border border-border p-3",
                s.completed_at && "opacity-60",
              )}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", KIND_STYLE[String(s.kind)])}>
                    {String(s.kind)}
                  </span>
                  {s.leg === "return" && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
                      return
                    </span>
                  )}
                  {s.passenger_name && <span className="text-sm font-medium">{s.passenger_name}</span>}
                </div>
                <div className="truncate text-sm">{s.address}</div>
                {s.notes && <div className="text-xs text-muted-foreground">{s.notes}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button disabled={busy || i === 0} onClick={() => move(i, -1)}
                  className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button disabled={busy || i === data.stops.length - 1} onClick={() => move(i, 1)}
                  className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label="Move down">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() => complete({ data: { stop_id: s.id, undo: !!s.completed_at } }))
                  }
                  className={cn(
                    "rounded p-1 hover:bg-muted",
                    s.completed_at ? "text-emerald-600" : "text-muted-foreground",
                  )}
                  aria-label="Toggle complete"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(() => removeStop({ data: { stop_id: s.id } }), "Stop removed")}
                  className="rounded p-1 text-red-600 hover:bg-red-500/10"
                  aria-label="Remove stop"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 rounded-xl border border-dashed border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as typeof newKind)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs">
              <option value="stop">Stop</option>
              <option value="pickup">Pickup</option>
              <option value="dropoff">Drop-off</option>
            </select>
            <select value={newLeg} onChange={(e) => setNewLeg(e.target.value as typeof newLeg)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs">
              <option value="outbound">Outbound</option>
              <option value="return">Return</option>
            </select>
            <Input className="h-8 flex-1 text-xs" placeholder="Passenger name (optional)"
              value={newPax} onChange={(e) => setNewPax(e.target.value)} />
          </div>
          <AddressAutocomplete
            value={newAddr}
            onChange={(v) => { setNewAddr(v); setNewCoords(null); }}
            onResolve={(p) => { setNewAddr(p.address); setNewCoords({ lat: p.lat, lng: p.lng }); }}
            placeholder="Add another stop address"
          />
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy || !newAddr.trim()}
            onClick={() =>
              run(async () => {
                const res = await addStop({
                  data: {
                    route_id: routeId,
                    kind: newKind,
                    leg: newLeg,
                    passenger_name: newPax.trim() || null,
                    address: newAddr.trim(),
                    lat: newCoords?.lat ?? null,
                    lng: newCoords?.lng ?? null,
                  },
                });
                setNewAddr("");
                setNewCoords(null);
                setNewPax("");
                return res;
              }, "Stop added")
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add stop
          </Button>
        </div>
      </div>
    </div>
  );
}
