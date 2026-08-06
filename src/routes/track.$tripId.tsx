import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseBrowser";
import { cancelRideRequest } from "@/lib/dispatch.functions";
import { RideChatSheet } from "@/components/chat/RideChatSheet";
import {
  Loader2,
  Phone,
  ChevronLeft,
  Pencil,
  MessageSquare,
  Shield,
  Users,
  Clock,
  MapPin,
  CircleDot,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/Brand";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/track/$tripId")({
  ssr: false,
  component: TrackPage,
});

/** Inline Google Maps embed — same pattern as pickup/ride screens. Renders
 * driver → pickup directions while en route, pickup → dropoff during the trip,
 * or a centered pin when only one coord is known. */
function TrackMapEmbed({
  pickup,
  dropoff,
  driver,
  center,
}: {
  pickup: [number, number] | null;
  dropoff: [number, number] | null;
  driver: [number, number] | null;
  center: [number, number];
}) {
  const fmt = (p: [number, number]) => `${p[0]},${p[1]}`;
  let src: string;
  if (driver && pickup) {
    src = `https://www.google.com/maps?saddr=${fmt(driver)}&daddr=${fmt(pickup)}&output=embed`;
  } else if (pickup && dropoff) {
    src = `https://www.google.com/maps?saddr=${fmt(pickup)}&daddr=${fmt(dropoff)}&output=embed`;
  } else {
    const c = driver ?? pickup ?? dropoff ?? center;
    src = `https://www.google.com/maps?q=${fmt(c)}&z=14&output=embed`;
  }
  return (
    <iframe
      title="Live ride tracking"
      src={src}
      className="h-full w-full border-0"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}


/* ---------- Status → human copy + timeline stage ---------- */
type StageKey = "assigned" | "en_route" | "arrived" | "in_progress" | "completed";

const STATUS_META: Record<
  string,
  { headline: string; sub: string; stage: StageKey; cta: string }
> = {
  scheduled: {
    headline: "Finding your driver",
    sub: "We're matching you with the nearest available driver.",
    stage: "assigned",
    cta: "Track ride",
  },
  assigned: {
    headline: "Driver assigned",
    sub: "Your driver has the trip and will be on the way shortly.",
    stage: "assigned",
    cta: "Track ride",
  },
  driver_en_route_to_pickup: {
    headline: "En route to pickup",
    sub: "Your driver is heading to your pickup location.",
    stage: "en_route",
    cta: "Track ride",
  },
  arrived_at_pickup: {
    headline: "Your driver has arrived",
    sub: "Meet your driver at the pickup location.",
    stage: "arrived",
    cta: "Confirm pickup",
  },
  in_progress: {
    headline: "Trip in progress",
    sub: "You're on your way to the destination.",
    stage: "in_progress",
    cta: "Track ride",
  },
  completed: {
    headline: "You've arrived",
    sub: "Thanks for riding with RedArt.",
    stage: "completed",
    cta: "Done",
  },
  cancelled: {
    headline: "Trip cancelled",
    sub: "This trip was cancelled.",
    stage: "assigned",
    cta: "Back",
  },
  no_show: {
    headline: "Marked no-show",
    sub: "This trip was closed as a no-show.",
    stage: "assigned",
    cta: "Back",
  },
};

const VEHICLE_LABEL: Record<string, { name: string; seats: number }> = {
  ambulatory: { name: "Ambulatory Van", seats: 4 },
  wheelchair_van: { name: "Wheelchair Van", seats: 3 },
  stretcher_van: { name: "Stretcher Van", seats: 1 },
  ground_ambulance: { name: "Ground Ambulance", seats: 1 },
  taxi: { name: "Taxi", seats: 4 },
};

type PublicTrip = {
  id: string;
  status: string;
  scheduled_pickup_time: string | null;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  driver_id: string | null;
  _driver: {
    id: string;
    user_id: string;
    current_lat: number | null;
    current_lng: number | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
    vehicle_color: string | null;
    vehicle_plate: string | null;
    profile: { first_name: string | null; last_name: string | null; phone: string | null } | null;
  } | null;
};

function TrackPage() {
  const { tripId } = Route.useParams();
  const navigate = useNavigate();
  const cancelFn = useServerFn(cancelRideRequest);
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  // Find the ride_request tied to this trip so we can cancel it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("ride_requests")
        .select("id")
        .eq("trip_id", tripId)
        .maybeSingle();
      if (!cancelled && data?.id) setRequestId(data.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function handleCancel() {
    const target = requestId;
    if (!target) {
      toast.error("Cancel unavailable — request id missing");
      return;
    }
    if (!window.confirm("Cancel this ride?")) return;
    setCancelling(true);
    try {
      await cancelFn({ data: { request_id: target } });
      toast.success("Ride cancelled");
      window.location.assign("/passenger");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }


  const trip = useQuery({
    queryKey: ["public-trip", tripId],
    queryFn: async (): Promise<PublicTrip | null> => {
      const { data, error } = await supabase.rpc("get_public_trip_track", { _trip_id: tripId });
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      if (!row || !row.id) return null;
      return {
        id: row.id as string,
        status: row.status as string,
        scheduled_pickup_time: (row.scheduled_pickup_time as string) ?? null,
        pickup_address: row.pickup_address as string,
        dropoff_address: row.dropoff_address as string,
        pickup_lat: (row.pickup_lat as number) ?? null,
        pickup_lng: (row.pickup_lng as number) ?? null,
        dropoff_lat: (row.dropoff_lat as number) ?? null,
        dropoff_lng: (row.dropoff_lng as number) ?? null,
        driver_id: (row.driver as { id?: string } | null)?.id ?? null,
        _driver: (row.driver as PublicTrip["_driver"]) ?? null,
      };
    },
    refetchInterval: 15_000,
  });

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const d = trip.data?._driver;
    if (d?.current_lat != null && d?.current_lng != null) {
      setDriverPos({ lat: d.current_lat, lng: d.current_lng });
    }
  }, [trip.data]);

  useEffect(() => {
    const did = trip.data?.driver_id;
    if (!did) return;
    const ch = supabase
      .channel(`track-${did}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${did}` },
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

  const [vehicleTier, setVehicleTier] = useState<{ name: string; seats: number }>({
    name: "Ambulatory Van",
    seats: 4,
  });
  useEffect(() => {
    // Best-effort read of vehicle_type from trips (RLS allows anon read of scheduled trips by id in some setups; fall back silently).
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("vehicle_type")
        .eq("id", tripId)
        .maybeSingle();
      const vt = (data as { vehicle_type?: string } | null)?.vehicle_type;
      if (vt && VEHICLE_LABEL[vt]) setVehicleTier(VEHICLE_LABEL[vt]);
    })().catch(() => {});
  }, [tripId]);

  const etaMin = useMemo(() => {
    if (!trip.data) return null;
    const pickup = trip.data.scheduled_pickup_time
      ? new Date(trip.data.scheduled_pickup_time).getTime()
      : null;
    if (pickup) {
      const diff = Math.round((pickup - Date.now()) / 60_000);
      if (diff >= 0 && diff < 240) return diff;
    }
    // Rough Haversine ETA when the driver is moving.
    if (driverPos && trip.data.pickup_lat && trip.data.pickup_lng) {
      const km = haversineKm(driverPos, {
        lat: trip.data.pickup_lat,
        lng: trip.data.pickup_lng,
      });
      return Math.max(1, Math.round((km / 40) * 60)); // assume 40 km/h avg
    }
    return null;
  }, [trip.data, driverPos]);

  if (trip.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }
  if (!trip.data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Trip not found.
      </div>
    );
  }

  const t = trip.data;
  const meta = STATUS_META[t.status] ?? {
    headline: t.status.replace(/_/g, " "),
    sub: "",
    stage: "assigned" as StageKey,
    cta: "Track ride",
  };
  const driver = t._driver;
  const center: [number, number] = driverPos
    ? [driverPos.lat, driverPos.lng]
    : t.pickup_lat && t.pickup_lng
      ? [t.pickup_lat, t.pickup_lng]
      : [39.5501, -105.7821];

  const etaClock =
    etaMin != null
      ? new Date(Date.now() + etaMin * 60_000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  const canEdit = t.status === "scheduled" || t.status === "assigned";
  const driverName = driver
    ? [driver.profile?.first_name, driver.profile?.last_name].filter(Boolean).join(" ") || "Your driver"
    : null;
  const driverInitials = driver
    ? `${(driver.profile?.first_name ?? "?")[0] ?? ""}${(driver.profile?.last_name ?? "")[0] ?? ""}`
    : "";

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* Full-screen map layer */}
      <div className="absolute inset-0">
        <TrackMapEmbed
          center={center}
          pickup={t.pickup_lat && t.pickup_lng ? [t.pickup_lat, t.pickup_lng] : null}
          dropoff={t.dropoff_lat && t.dropoff_lng ? [t.dropoff_lat, t.dropoff_lng] : null}
          driver={driverPos ? [driverPos.lat, driverPos.lng] : null}
        />
      </div>

      {/* Top overlay: back + address pill */}
      <div className="absolute inset-x-0 top-0 z-10 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <a
            href="/passenger"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-lift backdrop-blur-xl transition hover:bg-background"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </a>
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border/60 bg-background/90 px-3.5 py-2.5 shadow-lift backdrop-blur-xl">
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <CircleDot className="h-3.5 w-3.5 text-emerald-500" />
              <span className="h-4 w-px bg-border" />
              <MapPin className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-tight">
              <div className="truncate font-medium text-foreground">{t.pickup_address}</div>
              <div className="truncate text-muted-foreground">{t.dropoff_address}</div>
            </div>
            {canEdit && (
              <button
                className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="Edit locations"
                title="Tap to edit locations"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/90 shadow-lift backdrop-blur-xl">
            <BrandMark className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-t-3xl border-x border-t border-border/60 bg-background/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border" />

            {/* Status headline + ETA */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  Live
                </div>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                  {meta.headline}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">{meta.sub}</p>
              </div>
              {etaMin != null && meta.stage !== "completed" && (
                <div className="shrink-0 rounded-2xl border border-border/60 bg-surface-muted px-3 py-2 text-right">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Arriving
                  </div>
                  <div className="text-lg font-semibold leading-tight text-foreground">
                    {etaMin} min
                  </div>
                  {etaClock && (
                    <div className="text-[11px] text-muted-foreground">{etaClock}</div>
                  )}
                </div>
              )}
            </div>

            {/* Timeline */}
            <Timeline stage={meta.stage} />

            {/* Vehicle / service tier */}
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-border/60 bg-surface-muted px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{vehicleTier.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Medicaid-covered · Fixed rate
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {vehicleTier.seats}
              </div>
            </div>

            {/* Driver card */}
            {driver ? (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-surface p-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold uppercase text-primary">
                  {driverInitials || "R"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {driverName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[driver.vehicle_year, driver.vehicle_color, driver.vehicle_make, driver.vehicle_model]
                      .filter(Boolean)
                      .join(" ")}
                    {driver.vehicle_plate ? ` · ${driver.vehicle_plate}` : ""}
                  </div>
                </div>
                {driver.profile?.phone && (
                  <a
                    href={`tel:${driver.profile.phone}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition hover:brightness-110"
                    aria-label="Call driver"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
                <button
                  onClick={() => setChatOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-accent"
                  aria-label="Message driver"
                  title="Message driver"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-border/60 bg-surface-muted p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for a driver assignment…
              </div>
            )}

            {/* Primary action — Cancel is always available until the trip
                completes or is already cancelled. Passengers may cancel at any
                point in the ride lifecycle. */}
            {t.status === "completed" ? (
              <a
                href="/passenger"
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 text-sm font-semibold text-white shadow-soft transition hover:brightness-110"
              >
                <Clock className="h-4 w-4" />
                {meta.cta}
              </a>
            ) : t.status === "cancelled" ? (
              <a
                href="/passenger"
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition hover:brightness-110"
              >
                Back to rides
              </a>
            ) : (
              <button
                onClick={handleCancel}
                disabled={cancelling || !requestId}
                className={cn(
                  "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold shadow-soft transition",
                  "bg-red-600 text-white hover:brightness-110 disabled:opacity-60",
                )}
              >
                {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Cancel ride
              </button>
            )}
          </div>
        </div>
      </div>

      {driver && (
        <RideChatSheet
          open={chatOpen}
          onOpenChange={setChatOpen}
          driverUserId={driver.user_id}
          tripId={t.id}
          driverName={driverName ?? "Your driver"}
        />
      )}
    </div>
  );
}

/* ---------- Timeline strip ---------- */
function Timeline({ stage }: { stage: StageKey }) {
  const steps: { key: StageKey; label: string }[] = [
    { key: "assigned", label: "Assigned" },
    { key: "en_route", label: "En route" },
    { key: "arrived", label: "Arrived" },
    { key: "in_progress", label: "On trip" },
    { key: "completed", label: "Done" },
  ];
  const activeIdx = steps.findIndex((s) => s.key === stage);
  return (
    <div className="mt-4 flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = i <= activeIdx;
        return (
          <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                "h-1.5 w-full rounded-full transition-colors",
                done ? "bg-primary" : "bg-border",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium tracking-wide",
                done ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- utils ---------- */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
