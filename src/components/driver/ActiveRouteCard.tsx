import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Waypoints, ExternalLink, Check, Navigation, Loader2 } from "lucide-react";
import { getMyActiveRoute, completeRouteStop } from "@/lib/routes.functions";
import { openNavigation } from "@/lib/mapsDeepLink";
import { cn } from "@/lib/utils";

type Loaded = Awaited<ReturnType<typeof getMyActiveRoute>>;

const KIND_STYLE: Record<string, string> = {
  pickup: "bg-emerald-500/15 text-emerald-600",
  dropoff: "bg-red-500/15 text-red-600",
  stop: "bg-primary/15 text-primary",
};

/**
 * The driver's ordered multi-passenger stop list for an assigned route,
 * with a one-tap Google Maps link containing the waypoints in order.
 */
export function ActiveRouteCard() {
  const load = useServerFn(getMyActiveRoute);
  const complete = useServerFn(completeRouteStop);
  const [data, setData] = useState<Loaded>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await load(undefined));
    } catch {
      setData(null);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (!data || !data.stops.length) return null;

  const done = data.stops.filter((s) => s.completed_at).length;
  const next = data.stops.find((s) => !s.completed_at) ?? null;

  async function toggle(stopId: string, undo: boolean) {
    setBusy(stopId);
    try {
      setData(await complete({ data: { stop_id: stopId, undo } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update stop");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
          <Waypoints className="h-4 w-4" />
          Route · {done}/{data.stops.length} done
        </div>
        {data.mapsUrl && (
          <a
            href={data.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Maps route
          </a>
        )}
      </div>

      <div className="space-y-1.5">
        {data.stops.map((s, i) => {
          const isNext = next?.id === s.id;
          return (
            <div
              key={s.id}
              className={cn(
                "flex items-start gap-2 rounded-xl bg-surface p-2.5",
                s.completed_at && "opacity-50",
                isNext && "ring-1 ring-primary",
              )}
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 text-[10px] font-semibold uppercase",
                      KIND_STYLE[String(s.kind)],
                    )}
                  >
                    {String(s.kind)}
                  </span>
                  {s.leg === "return" && (
                    <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
                      return
                    </span>
                  )}
                  {s.passenger_name && (
                    <span className="text-xs font-medium">{s.passenger_name}</span>
                  )}
                </div>
                <div className="text-xs">{s.address}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openNavigation({ lat: s.lat, lng: s.lng, address: s.address })}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Navigate to stop"
                >
                  <Navigation className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={busy === s.id}
                  onClick={() => void toggle(s.id, !!s.completed_at)}
                  className={cn(
                    "rounded p-1 hover:bg-muted",
                    s.completed_at ? "text-emerald-600" : "text-muted-foreground",
                  )}
                  aria-label="Mark stop done"
                >
                  {busy === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
