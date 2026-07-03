import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { TrackMap } from "@/components/nemt/useClientMap";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Loader2, Phone } from "lucide-react";
import { humanizeStatus } from "@/lib/format";

export const Route = createFileRoute("/track/$tripId")({
  ssr: false,
  component: TrackPage,
});

const STATUS_HEADLINE: Record<string, string> = {
  scheduled: "Your driver is being assigned",
  assigned: "Your driver is on the way!",
  driver_en_route_to_pickup: "Your driver is on the way!",
  arrived_at_pickup: "Your driver has arrived!",
  in_progress: "You're on your way!",
  completed: "You've arrived. Thank you!",
  cancelled: "This trip was cancelled.",
  no_show: "This trip is marked no-show.",
};

type PublicTrip = {
  id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  driver_id: string | null;
  gps_route: Array<{ lat: number; lng: number; ts: number }> | null;
};

function TrackPage() {
  const { tripId } = Route.useParams();

  const trip = useQuery({
    queryKey: ["public-trip", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("id, status, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, driver_id, gps_route")
        .eq("id", tripId)
        .maybeSingle();
      if (error) throw error;
      return data as PublicTrip | null;
    },
    refetchInterval: 15_000,
  });

  const driver = useQuery({
    queryKey: ["public-driver", trip.data?.driver_id],
    enabled: !!trip.data?.driver_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("drivers")
        .select("id, user_id, current_lat, current_lng, vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_plate")
        .eq("id", trip.data!.driver_id!)
        .maybeSingle();
      if (!data) return null;
      const { data: prof } = await supabase
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("id", data.user_id)
        .maybeSingle();
      return { ...data, profile: prof };
    },
    refetchInterval: 20_000,
  });

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (driver.data?.current_lat != null && driver.data?.current_lng != null) {
      setDriverPos({ lat: driver.data.current_lat, lng: driver.data.current_lng });
    }
  }, [driver.data]);

  useEffect(() => {
    if (!trip.data?.driver_id) return;
    const ch = supabase
      .channel(`track-${trip.data.driver_id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${trip.data.driver_id}` },
        (payload) => {
          const r = payload.new as { current_lat?: number; current_lng?: number };
          if (r.current_lat != null && r.current_lng != null) {
            setDriverPos({ lat: r.current_lat, lng: r.current_lng });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [trip.data?.driver_id]);

  if (trip.isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!trip.data) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Trip not found.</div>;
  }

  const t = trip.data;
  const center: [number, number] = driverPos
    ? [driverPos.lat, driverPos.lng]
    : t.pickup_lat && t.pickup_lng
      ? [t.pickup_lat, t.pickup_lng]
      : [39.5501, -105.7821];

  return (
    <div className="min-h-screen bg-background pb-safe">
      <header className="glass sticky top-0 z-20 border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">RedArt LLC — Ride tracking</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-soft">
          <StatusPill status={t.status} />
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            {STATUS_HEADLINE[t.status] ?? humanizeStatus(t.status)}
          </h2>

          {driver.data && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface-muted p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                {(driver.data.profile?.first_name ?? "?")[0]}
                {(driver.data.profile?.last_name ?? "")[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {driver.data.profile?.first_name} {driver.data.profile?.last_name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {driver.data.vehicle_year} {driver.data.vehicle_color} {driver.data.vehicle_make}{" "}
                  {driver.data.vehicle_model} · {driver.data.vehicle_plate}
                </div>
              </div>
              {driver.data.profile?.phone && (
                <a
                  href={`tel:${driver.data.profile.phone}`}
                  className="rounded-full bg-primary p-3 text-primary-foreground shadow-soft"
                  aria-label="Call driver"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-soft">
          <div className="h-[380px]">
            <TrackMap
              center={center}
              pickup={t.pickup_lat && t.pickup_lng ? [t.pickup_lat, t.pickup_lng] : null}
              dropoff={t.dropoff_lat && t.dropoff_lng ? [t.dropoff_lat, t.dropoff_lng] : null}
              driver={driverPos ? [driverPos.lat, driverPos.lng] : null}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-soft">
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pickup</div>
              <div>{t.pickup_address}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dropoff</div>
              <div>{t.dropoff_address}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
