import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatCard } from "@/components/nemt/StatCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, Route as RouteIcon, Clock, DollarSign, Fuel } from "lucide-react";
import { formatCurrency, addDays, startOfDay, endOfDay } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { getPayroll } from "@/lib/admin.functions";
import { RouteMap } from "@/components/nemt/useClientMap";
import { detectStops } from "@/lib/geo";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

type DriverOpt = { id: string; name: string };

function useDriverOptions() {
  return useQuery({
    queryKey: ["driver-options"],
    queryFn: async () => {
      const { data: drivers } = await supabase.from("drivers").select("id, user_id");
      const ids = (drivers ?? []).map((d) => d.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids)
        : { data: [] };
      const map = new Map<string, { first_name: string | null; last_name: string | null }>();
      (profs ?? []).forEach((p) => map.set(p.id, p));
      return (drivers ?? []).map((d) => ({
        id: d.id,
        name:
          [map.get(d.user_id)?.first_name, map.get(d.user_id)?.last_name].filter(Boolean).join(" ") ||
          `Driver ${d.id.slice(0, 6)}`,
      })) as DriverOpt[];
    },
  });
}

function ReportsPage() {
  const drivers = useDriverOptions();
  const [driverId, setDriverId] = useState<string>("");
  const [range, setRange] = useState<"today" | "7d" | "all">("7d");

  const period = useMemo(() => {
    const now = new Date();
    if (range === "today") return { from: startOfDay(now), to: endOfDay(now) };
    if (range === "7d") return { from: startOfDay(addDays(now, -7)), to: endOfDay(now) };
    return { from: new Date("2000-01-01"), to: endOfDay(now) };
  }, [range]);

  const payrollFn = useServerFn(getPayroll);
  const payroll = useQuery({
    queryKey: ["payroll", driverId, period.from.toISOString(), period.to.toISOString()],
    enabled: !!driverId,
    queryFn: () =>
      payrollFn({ data: { driver_id: driverId, from: period.from.toISOString(), to: period.to.toISOString() } }),
  });

  const routeQuery = useQuery({
    queryKey: ["driver-routes", driverId, period.from.toISOString(), period.to.toISOString()],
    enabled: !!driverId,
    queryFn: async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, gps_route")
        .eq("driver_id", driverId)
        .gte("actual_pickup_time", period.from.toISOString())
        .lte("actual_dropoff_time", period.to.toISOString())
        .eq("status", "completed");
      return data ?? [];
    },
  });

  const allPoints = (routeQuery.data ?? [])
    .flatMap((t) => (t.gps_route as Array<{ lat: number; lng: number; ts: number }>) ?? [])
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  const stops = detectStops(allPoints);
  const center: [number, number] = allPoints.length
    ? [allPoints[0].lat, allPoints[0].lng]
    : [39.5501, -105.7821];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Payroll, mileage, GPS routes." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Driver
          </label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger className="rounded-full"><SelectValue placeholder="Pick a driver" /></SelectTrigger>
            <SelectContent>
              {drivers.data?.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Period
          </label>
          <Select value={range} onValueChange={(v: "today" | "7d" | "all") => setRange(v)}>
            <SelectTrigger className="rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {driverId && (
          <a
            className="ml-auto"
            target="_blank"
            rel="noreferrer"
            href={`/payroll/${driverId}?from=${period.from.toISOString()}&to=${period.to.toISOString()}`}
          >
            <Button variant="secondary" className="rounded-full">
              <ExternalLink className="mr-2 h-4 w-4" /> Export payroll
            </Button>
          </a>
        )}
      </div>

      {!driverId && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Pick a driver to see their earnings and route.
        </div>
      )}

      {driverId && payroll.isLoading && (
        <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin" /></div>
      )}

      {payroll.data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Trips" value={payroll.data.trips_completed} icon={<RouteIcon className="h-5 w-5" />} />
            <StatCard label="Hours" value={payroll.data.hours} icon={<Clock className="h-5 w-5" />} accent="info" />
            <StatCard label="Fuel" value={formatCurrency(payroll.data.fuel_cost)} icon={<Fuel className="h-5 w-5" />} accent="warning" />
            <StatCard label="Total pay" value={formatCurrency(payroll.data.total)} icon={<DollarSign className="h-5 w-5" />} accent="success" />
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">GPS route</h2>
            <div className="h-[400px] overflow-hidden rounded-xl">
              <RouteMap
                center={center}
                path={allPoints}
                stops={stops.map((s, i) => ({
                  lat: s.lat,
                  lng: s.lng,
                  label: `Stop ${i + 1} — ${Math.round(s.durationMs / 60_000)} min`,
                }))}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Blue line = travel path. Red dots = stops longer than 2 minutes.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
