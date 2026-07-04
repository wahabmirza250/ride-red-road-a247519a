import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { DriverFleetMap, type DriverMarker } from "@/components/nemt/useClientMap";
import { fmtMoney } from "@/lib/rideMath";

export const Route = createFileRoute("/_authenticated/live-ops")({
  component: LiveOps,
});

type DriverRow = {
  id: string;
  user_id: string;
  is_online: boolean;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
  name?: string;
};
type Req = {
  id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number | null;
  created_at: string;
};

function LiveOps() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);

  const load = useCallback(async () => {
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase.from("drivers").select("id,user_id,is_online,status,current_lat,current_lng"),
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
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const markers: DriverMarker[] = drivers
    .filter((d) => d.current_lat != null && d.current_lng != null)
    .map((d) => ({
      id: d.id,
      lat: Number(d.current_lat),
      lng: Number(d.current_lng),
      status:
        d.status === "on_trip"
          ? "on_trip"
          : d.is_online
            ? "available"
            : "offline",
      label: d.status,
    }));

  const center: [number, number] =
    markers.length > 0 ? [markers[0].lat, markers[0].lng] : [39.7392, -104.9903];

  const onlineCount = drivers.filter((d) => d.is_online).length;

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
        <DriverFleetMap center={center} markers={markers} />
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
