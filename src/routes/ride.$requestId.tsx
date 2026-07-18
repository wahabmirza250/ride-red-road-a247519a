import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseBrowser";
import { TrackMap } from "@/components/nemt/useClientMap";
import { dispatchRideRequest } from "@/lib/dispatch.functions";
import {
  Loader2,
  ChevronLeft,
  MapPin,
  CircleDot,
  Phone,
  MessageSquare,
  Car,
  AlertTriangle,
  RefreshCw,
  LifeBuoy,
} from "lucide-react";
import { BrandMark } from "@/components/Brand";
import { useSignedUrl } from "@/lib/signedUrl";

export const Route = createFileRoute("/ride/$requestId")({
  ssr: false,
  component: RidePage,
});

const OFFER_WAIT_MS = 45_000; // grace period before showing "no drivers" UI

type RideRequestRow = {
  id: string;
  status: string;
  driver_id: string | null;
  trip_id: string | null;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  offer_expires_at: string | null;
  created_at: string;
  contact_phone: string | null;
};

type DriverRow = {
  id: string;
  user_id: string;
  current_lat: number | null;
  current_lng: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
  vehicle_photo_path: string | null;
  photo_url: string | null;
  profile: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
};

function RidePage() {
  const { requestId } = Route.useParams();
  const navigate = useNavigate();
  const redispatch = useServerFn(dispatchRideRequest);

  const [req, setReq] = useState<RideRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Load + subscribe to ride_request row.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("ride_requests")
        .select(
          "id,status,driver_id,trip_id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,offer_expires_at,created_at,contact_phone",
        )
        .eq("id", requestId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
      } else {
        setReq(data as RideRequestRow);
      }
      setLoading(false);
    })();

    const ch = supabase
      .channel(`ride-req-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ride_requests", filter: `id=eq.${requestId}` },
        (payload) => {
          setReq((prev) => ({ ...(prev ?? ({} as RideRequestRow)), ...(payload.new as RideRequestRow) }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [requestId]);

  // Once a trip is created, redirect to the polished track page.
  useEffect(() => {
    if (req?.trip_id && (req.status === "accepted" || req.status === "in_progress")) {
      navigate({ to: "/track/$tripId", params: { tripId: req.trip_id } });
    }
  }, [req?.trip_id, req?.status, navigate]);

  // Tick each second for wait-timer / "no drivers" logic.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Load driver info as soon as one is assigned (offer state), realtime updates.
  const [driver, setDriver] = useState<DriverRow | null>(null);
  useEffect(() => {
    const did = req?.driver_id;
    if (!did) {
      setDriver(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("drivers")
        .select(
          "id,user_id,current_lat,current_lng,vehicle_make,vehicle_model,vehicle_year,vehicle_color,vehicle_plate,vehicle_photo_path",
        )
        .eq("id", did)
        .maybeSingle();
      if (cancelled || !data) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("first_name,last_name,phone,avatar_url")
        .eq("id", (data as { user_id: string }).user_id)
        .maybeSingle();
      if (cancelled) return;
      setDriver({ ...(data as Omit<DriverRow, "profile">), profile: (prof as DriverRow["profile"]) ?? null });
    })();

    const ch = supabase
      .channel(`ride-driver-${did}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${did}` },
        (payload) => {
          const n = payload.new as Partial<DriverRow>;
          setDriver((prev) => (prev ? { ...prev, ...n } : prev));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [req?.driver_id]);

  const created = req?.created_at ? new Date(req.created_at).getTime() : now;
  const waited = now - created;
  const noDriverYet =
    !!req &&
    req.status === "pending" &&
    !req.driver_id &&
    waited > OFFER_WAIT_MS;

  const pickup: [number, number] | null =
    req?.pickup_lat != null && req?.pickup_lng != null
      ? [Number(req.pickup_lat), Number(req.pickup_lng)]
      : null;
  const dropoff: [number, number] | null =
    req?.dropoff_lat != null && req?.dropoff_lng != null
      ? [Number(req.dropoff_lat), Number(req.dropoff_lng)]
      : null;
  const driverPos: [number, number] | null =
    driver?.current_lat != null && driver?.current_lng != null
      ? [Number(driver.current_lat), Number(driver.current_lng)]
      : null;

  const center: [number, number] = driverPos ?? pickup ?? [39.5501, -105.7821];

  const driverName = driver
    ? [driver.profile?.first_name, driver.profile?.last_name].filter(Boolean).join(" ") ||
      "Your driver"
    : null;

  const etaMin = useMemo(() => {
    if (!driverPos || !pickup) return null;
    const km = haversineKm(
      { lat: driverPos[0], lng: driverPos[1] },
      { lat: pickup[0], lng: pickup[1] },
    );
    return Math.max(1, Math.round((km / 40) * 60));
  }, [driverPos, pickup]);

  async function handleRetry() {
    if (!req) return;
    setRetrying(true);
    try {
      await redispatch({ data: { request_id: req.id } });
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }
  if (notFound || !req) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">This ride request could not be found.</p>
        <Link to="/passenger" className="text-sm font-medium text-primary hover:underline">
          Back to rides
        </Link>
      </div>
    );
  }

  const hasMatch = !!driver;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* Map layer */}
      <div className="absolute inset-0">
        <TrackMap center={center} pickup={pickup} dropoff={dropoff} driver={driverPos} />
      </div>

      {/* Searching overlay pulse (only when still searching) */}
      {!hasMatch && !noDriverYet && (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
          <div className="relative flex h-40 w-40 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/25" />
            <span
              className="absolute inline-flex h-2/3 w-2/3 animate-ping rounded-full bg-primary/35"
              style={{ animationDelay: "300ms" }}
            />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift">
              <Car className="h-6 w-6" />
            </span>
          </div>
        </div>
      )}

      {/* Top overlay: back + route pill */}
      <div className="absolute inset-x-0 top-0 z-10 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <Link
            to="/passenger"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-lift backdrop-blur-xl transition hover:bg-background"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border/60 bg-background/90 px-3.5 py-2.5 shadow-lift backdrop-blur-xl">
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <CircleDot className="h-3.5 w-3.5 text-emerald-500" />
              <span className="h-4 w-px bg-border" />
              <MapPin className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-tight">
              <div className="truncate font-medium text-foreground">{req.pickup_address}</div>
              <div className="truncate text-muted-foreground">{req.dropoff_address}</div>
            </div>
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

            {noDriverYet ? (
              <NoDriverBlock retrying={retrying} onRetry={handleRetry} />
            ) : hasMatch ? (
              <MatchedBlock driver={driver!} driverName={driverName!} etaMin={etaMin} />
            ) : (
              <SearchingBlock waitedSec={Math.floor(waited / 1000)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-blocks ---------- */

function SearchingBlock({ waitedSec }: { waitedSec: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        Searching
      </div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
        Finding your driver…
      </h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        We're matching you with the closest available driver. This usually takes under a minute.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <SkeletonPulse />
        <SkeletonPulse />
        <SkeletonPulse />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-border/60 bg-surface-muted px-4 py-3 text-xs text-muted-foreground">
        <span>Elapsed</span>
        <span className="font-mono text-sm font-semibold text-foreground">
          {formatMMSS(waitedSec)}
        </span>
      </div>
    </div>
  );
}

function SkeletonPulse() {
  return (
    <div className="h-16 animate-pulse rounded-2xl border border-border/60 bg-surface-muted" />
  );
}

function MatchedBlock({
  driver,
  driverName,
  etaMin,
}: {
  driver: DriverRow;
  driverName: string;
  etaMin: number | null;
}) {
  const initials = `${(driver.profile?.first_name ?? "?")[0] ?? ""}${(driver.profile?.last_name ?? "")[0] ?? ""}`;
  const vehicleDesc = [driver.vehicle_year, driver.vehicle_color, driver.vehicle_make, driver.vehicle_model]
    .filter(Boolean)
    .join(" ");
  const vehiclePhotoUrl = useSignedUrl("vehicle-photos", driver.vehicle_photo_path);
  const driverPhotoUrl = useSignedUrl("driver-photos", driver.photo_url);
  const avatarUrl = driverPhotoUrl ?? (driver.profile?.avatar_url ? driver.profile.avatar_url : null);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-500">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Driver on the way
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            {driverName}
          </h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {vehicleDesc || "Vehicle details incoming"}
            {driver.vehicle_plate ? ` · ${driver.vehicle_plate}` : ""}
          </p>
        </div>
        {etaMin != null && (
          <div className="shrink-0 rounded-2xl border border-border/60 bg-surface-muted px-3 py-2 text-right">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Arriving
            </div>
            <div className="text-lg font-semibold leading-tight text-foreground">
              {etaMin} min
            </div>
          </div>
        )}
      </div>

      {/* Vehicle photo strip */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-sky-500/15 via-sky-500/5 to-transparent">
        {vehiclePhotoUrl ? (
          <img
            src={vehiclePhotoUrl}
            alt={vehicleDesc || "Vehicle"}
            className="h-32 w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-32 w-full items-center justify-center">
            <Car className="h-10 w-10 text-sky-500/70" />
          </div>
        )}
      </div>

      {/* Driver row */}
      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-surface p-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary/10 text-base font-semibold uppercase text-primary">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={driverName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {initials || "R"}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{driverName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {driver.profile?.phone ?? "Contact via app"}
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
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-accent"
          aria-label="Message driver"
          title="Message driver"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function NoDriverBlock({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" />
        No match yet
      </div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
        No drivers available right now
      </h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        We couldn't reach a nearby driver. You can retry or contact dispatch and we'll take it
        from here.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={onRetry}
          disabled={retrying}
          className="flex h-11 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition hover:brightness-110 disabled:opacity-60"
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Retry
        </button>
        <a
          href="tel:+18005551234"
          className="flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-semibold text-foreground transition hover:bg-accent"
        >
          <LifeBuoy className="h-4 w-4" />
          Call support
        </a>
      </div>
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
function formatMMSS(sec: number) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
