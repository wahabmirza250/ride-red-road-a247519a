import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatCard } from "@/components/nemt/StatCard";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Users, Route as RouteIcon, DollarSign, CheckCircle2 } from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type DriverRow = {
  id: string;
  status: "available" | "on_trip" | "offline";
  current_lat: number | null;
  current_lng: number | null;
  profiles: { first_name: string | null; last_name: string | null } | null;
};

function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const iso = startOfDay.toISOString();

      const [tripsToday, activeDrivers, pendingBilling, completedToday] = await Promise.all([
        supabase
          .from("trips")
          .select("id", { count: "exact", head: true })
          .gte("scheduled_pickup_time", iso),
        supabase
          .from("drivers")
          .select("id", { count: "exact", head: true })
          .in("status", ["available", "on_trip"]),
        supabase
          .from("billing_records")
          .select("amount")
          .eq("status", "pending"),
        supabase
          .from("trips")
          .select("id", { count: "exact", head: true })
          .eq("status", "completed")
          .gte("updated_at", iso),
      ]);

      const pendingTotal =
        pendingBilling.data?.reduce((s, r) => s + Number(r.amount ?? 0), 0) ?? 0;

      return {
        tripsToday: tripsToday.count ?? 0,
        activeDrivers: activeDrivers.count ?? 0,
        pendingTotal,
        completedToday: completedToday.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });
}

function useDriversWithLocation() {
  return useQuery({
    queryKey: ["drivers-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, status, current_lat, current_lng, user_id");
      if (error) throw error;
      // fetch profiles separately (avoid RLS join complications)
      const userIds = (data ?? []).map((d) => d.user_id);
      const profileMap = new Map<string, { first_name: string | null; last_name: string | null }>();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", userIds);
        (profiles ?? []).forEach((p) => profileMap.set(p.id, p));
      }
      return (data ?? []).map((d) => ({
        ...d,
        profiles: profileMap.get(d.user_id) ?? null,
      })) as DriverRow[];
    },
    refetchInterval: 20_000,
  });
}

function useRecentActivity() {
  return useQuery({
    queryKey: ["recent-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("id, status, pickup_address, dropoff_address, updated_at")
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
}

function DashboardPage() {
  const stats = useDashboardStats();
  const drivers = useDriversWithLocation();
  const activity = useRecentActivity();

  // Realtime toast on trip status changes
  useEffect(() => {
    const ch = supabase
      .channel("dashboard-trips")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips" },
        (payload) => {
          const oldStatus = (payload.old as { status?: string })?.status;
          const newStatus = (payload.new as { status?: string })?.status;
          if (oldStatus && newStatus && oldStatus !== newStatus) {
            toast(`Trip status → ${newStatus.replace(/_/g, " ")}`, {
              duration: 8000,
            });
            activity.refetch();
            stats.refetch();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers" },
        () => {
          drivers.refetch();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Colorado default center
  const [mapCenter] = useState<[number, number]>([39.5501, -105.7821]);
  const markers = (drivers.data ?? []).filter(
    (d) => d.current_lat != null && d.current_lng != null,
  );

  const markerColor = (s: DriverRow["status"]) =>
    s === "available" ? "#16a34a" : s === "on_trip" ? "#2563eb" : "#9ca3af";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch overview"
        description="Live map, today's activity, and pending work."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Trips today"
          value={stats.data?.tripsToday ?? "—"}
          icon={<RouteIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Active drivers"
          value={stats.data?.activeDrivers ?? "—"}
          icon={<Users className="h-5 w-5" />}
          accent="info"
        />
        <StatCard
          label="Pending billing"
          value={stats.data ? formatCurrency(stats.data.pendingTotal) : "—"}
          icon={<DollarSign className="h-5 w-5" />}
          accent="warning"
        />
        <StatCard
          label="Completed today"
          value={stats.data?.completedToday ?? "—"}
          icon={<CheckCircle2 className="h-5 w-5" />}
          accent="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Live driver map</h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success" /> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-info" /> On trip
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> Offline
              </span>
            </div>
          </div>
          <div className="h-[420px] overflow-hidden rounded-xl">
            <MapContainer
              center={mapCenter}
              zoom={7}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {markers.map((d) => (
                <CircleMarker
                  key={d.id}
                  center={[d.current_lat!, d.current_lng!]}
                  radius={9}
                  pathOptions={{
                    color: markerColor(d.status),
                    fillColor: markerColor(d.status),
                    fillOpacity: 0.85,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">
                        {d.profiles?.first_name} {d.profiles?.last_name}
                      </div>
                      <div className="text-muted-foreground">{d.status}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          {activity.data?.length ? (
            <ul className="divide-y divide-border">
              {activity.data.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {t.pickup_address}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      → {t.dropoff_address}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDateTime(t.updated_at)}
                    </div>
                  </div>
                  <StatusPill status={t.status} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No recent activity yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
