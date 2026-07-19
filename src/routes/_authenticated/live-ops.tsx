import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { GoogleFleetMap, type FleetMarker } from "@/components/nemt/GoogleFleetMap";
import { fmtMoney } from "@/lib/rideMath";

export const Route = createFileRoute("/_authenticated/live-ops")({
  component: LiveOps,
});

const DEFAULT_CENTER: [number, number] = [39.7392, -104.9903]; // Denver
const DEFAULT_ZOOM = 11;

type DriverRow = {
  id: string;
  user_id: string;
  status: "available" | "busy" | "offline";
  current_lat: number | null;
  current_lng: number | null;
  name?: string;
};
type Req = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  contact_phone: string | null;
  estimated_fare: number | null;
  created_at: string;
};


function LiveOps() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; id?: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase.from("drivers").select("id,user_id,status,current_lat,current_lng"),
      supabase
        .from("ride_requests")
        .select("id,status,pickup_address,dropoff_address,estimated_fare,created_at")
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const rows = (d ?? []) as DriverRow[];
    const ids = rows.map((x) => x.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids)
      : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
    const map = new Map<string, string>();
    (profs ?? []).forEach((p) =>
      map.set(p.id, (p.first_name ?? "").trim() || `${p.last_name ?? "Driver"}`),
    );
    setDrivers(rows.map((x) => ({ ...x, name: map.get(x.user_id) ?? "Driver" })));
    setReqs((r ?? []) as Req[]);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("live-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, load)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips" },
        (payload) => {
          const oldStatus = (payload.old as { status?: string } | null)?.status;
          const newStatus = (payload.new as { status?: string } | null)?.status;
          if (newStatus && oldStatus !== newStatus) {
            const label: Record<string, string> = {
              driver_en_route_to_pickup: "Driver started pickup",
              arrived_at_pickup: "Driver arrived at pickup",
              in_progress: "Trip in progress",
              completed: "Trip completed",
              cancelled: "Trip cancelled",
            };
            const msg = label[newStatus];
            if (msg) toast(msg);
          }
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const markers: FleetMarker[] = drivers
    .filter((d) => d.current_lat != null && d.current_lng != null)
    .map((d) => ({
      id: d.id,
      lat: Number(d.current_lat),
      lng: Number(d.current_lng),
      status: d.status,
      label: d.name ?? "Driver",
    }));

  const onlineCount = drivers.filter((d) => d.status !== "offline").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live Ops</h1>
        <p className="text-sm text-muted-foreground">
          Real-time drivers + active ride requests. Updates automatically.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Drivers online", value: onlineCount },
          { label: "Pending requests", value: reqs.filter((r) => r.status === "pending").length },
          { label: "Active trips", value: reqs.filter((r) => r.status === "accepted").length },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="h-[420px] overflow-hidden rounded-2xl border border-border">
        <GoogleFleetMap
          center={DEFAULT_CENTER}
          markers={markers}
          focus={focus}
          onMarkerClick={(id) => {
            const d = drivers.find((x) => x.id === id);
            if (d?.current_lat && d?.current_lng)
              setFocus({ lat: Number(d.current_lat), lng: Number(d.current_lng), zoom: 14, id });
          }}
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between text-sm font-semibold">
          <span>Drivers ({drivers.length})</span>
          {focus && (
            <button
              className="text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={() => setFocus(null)}
            >
              Reset view
            </button>
          )}
        </div>
        <div className="divide-y divide-border">
          {drivers.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No drivers yet.</div>
          )}
          {drivers.map((d) => {
            const hasGps = d.current_lat != null && d.current_lng != null;
            const dot =
              d.status === "busy"
                ? "bg-amber-500"
                : d.status === "available"
                  ? "bg-emerald-500"
                  : "bg-gray-400";
            const selected = focus?.id === d.id;
            return (
              <button
                key={d.id}
                disabled={!hasGps}
                onClick={() =>
                  hasGps &&
                  setFocus({
                    id: d.id,
                    lat: Number(d.current_lat),
                    lng: Number(d.current_lng),
                    zoom: 16,
                  })
                }
                className={`flex w-full items-center justify-between py-3 text-left text-sm transition ${
                  selected ? "bg-primary/5" : ""
                } ${hasGps ? "hover:bg-muted/50 cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  <div>
                    <div className="font-medium">{d.name ?? "Driver"}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.status.replace(/_/g, " ")}
                      {!hasGps && " · no GPS"}
                    </div>
                  </div>
                </div>
                {hasGps && (
                  <div className="text-xs font-mono text-muted-foreground">
                    {Number(d.current_lat).toFixed(3)}, {Number(d.current_lng).toFixed(3)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-sm font-semibold">Active requests</div>
        <div className="divide-y divide-border">
          {reqs.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Nothing active.</div>
          )}
          {reqs.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  {r.status}
                </div>
                <div className="truncate">↑ {r.pickup_address}</div>
                <div className="truncate">↓ {r.dropoff_address}</div>
              </div>
              <div className="ml-3 font-semibold">{fmtMoney(r.estimated_fare)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
