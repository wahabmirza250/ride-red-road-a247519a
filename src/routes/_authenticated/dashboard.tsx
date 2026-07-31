import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { DriverTripMap, type LatLng } from "@/components/nemt/DriverTripMap";
import { Avatar } from "@/components/Avatar";
import {
  Search,
  Star,
  MapPin,
  Circle,
  Gauge,
  Clock,
  Users as UsersIcon,
  MessageSquare,
  ChevronDown,
  History,
  Car,
  Fuel,
  Radio,

} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type DriverListRow = {
  id: string;
  user_id: string;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
  photo_url: string | null;
  vehicle_photo_path: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  default_vin: string | null;
  rating: number | null;
  total_trips: number | null;
  total_ratings: number | null;
  profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    created_at: string | null;
  } | null;
};

type CurrentTrip = {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  scheduled_pickup_time: string | null;
  actual_pickup_time: string | null;
  actual_dropoff_time: string | null;
  computed_miles: number | null;
  gps_miles: number | null;
  source: "trips" | "medicaid_trips";
};

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (["in_progress", "busy", "active", "available"].includes(s))
    return { label: "Active", classes: "bg-brand-green/20 text-brand-green ring-1 ring-brand-green/40" };
  if (["completed", "done", "reviewed"].includes(s))
    return { label: "Completed", classes: "bg-brand-blue/20 text-brand-blue ring-1 ring-brand-blue/40" };
  if (["scheduled", "pending", "assigned", "pending_review"].includes(s))
    return { label: "Scheduled", classes: "bg-brand-yellow/25 text-brand-yellow-foreground ring-1 ring-brand-yellow/50 dark:text-brand-yellow" };
  return { label: status.replace(/_/g, " "), classes: "bg-muted text-foreground ring-1 ring-border" };
}

function initials(first?: string | null, last?: string | null) {
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

function useDrivers() {
  return useQuery({
    queryKey: ["dashboard-drivers-v2"],
    queryFn: async (): Promise<DriverListRow[]> => {
      const { data, error } = await supabase
        .from("drivers")
        .select(
          "id, user_id, status, current_lat, current_lng, photo_url, vehicle_photo_path, vehicle_make, vehicle_model, vehicle_year, vehicle_plate, default_vin, rating, total_trips, total_ratings",
        );
      if (error) throw error;
      const rows = data ?? [];
      const userIds = rows.map((r) => r.user_id).filter(Boolean);
      const profileMap = new Map<string, DriverListRow["profile"]>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, phone, avatar_url, created_at")
          .in("id", userIds);
        (profs ?? []).forEach((p) =>
          profileMap.set(p.id, {
            first_name: p.first_name,
            last_name: p.last_name,
            email: p.email,
            phone: p.phone,
            avatar_url: p.avatar_url,
            created_at: p.created_at,
          }),
        );
      }
      return rows.map((r) => ({ ...r, profile: profileMap.get(r.user_id) ?? null }));
    },
    refetchInterval: 20_000,
  });
}

function useCurrentTrip(driverId: string | null) {
  return useQuery({
    enabled: !!driverId,
    queryKey: ["dashboard-current-trip", driverId],
    queryFn: async (): Promise<CurrentTrip | null> => {
      if (!driverId) return null;
      const { data: trip } = await supabase
        .from("trips")
        .select(
          "id, status, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, scheduled_pickup_time, actual_pickup_time, actual_dropoff_time, computed_miles, gps_miles",
        )
        .eq("driver_id", driverId)
        .order("scheduled_pickup_time", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (trip) return { ...trip, source: "trips" as const };

      // Fallback: medicaid_trips (no lat/lng columns aren't in that table for pickup/dropoff)
      const { data: mtrip } = await supabase
        .from("medicaid_trips")
        .select(
          "id, status, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_at, ride_started_at, arrived_dropoff_at, miles",
        )
        .eq("driver_id", driverId)
        .order("pickup_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (!mtrip) return null;
      return {
        id: mtrip.id,
        status: mtrip.status,
        pickup_address: mtrip.pickup_address,
        dropoff_address: mtrip.dropoff_address,
        pickup_lat: mtrip.pickup_lat,
        pickup_lng: mtrip.pickup_lng,
        dropoff_lat: mtrip.dropoff_lat,
        dropoff_lng: mtrip.dropoff_lng,
        scheduled_pickup_time: mtrip.pickup_at,
        actual_pickup_time: mtrip.ride_started_at,
        actual_dropoff_time: mtrip.arrived_dropoff_at,
        computed_miles: Number(mtrip.miles ?? 0),
        gps_miles: null,
        source: "medicaid_trips" as const,
      };
    },
    refetchInterval: 30_000,
  });
}

function useSignedImage(bucket: string, path: string | null | undefined) {
  return useQuery({
    enabled: !!path,
    queryKey: ["signed", bucket, path],
    queryFn: async () => {
      if (!path) return null;
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
    staleTime: 30 * 60_000,
  });
}

function DashboardPage() {
  const drivers = useDrivers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Default selection to first driver.
  useEffect(() => {
    if (!selectedId && drivers.data && drivers.data.length > 0) {
      setSelectedId(drivers.data[0].id);
    }
  }, [drivers.data, selectedId]);

  const selected = useMemo(
    () => drivers.data?.find((d) => d.id === selectedId) ?? null,
    [drivers.data, selectedId],
  );

  const trip = useCurrentTrip(selectedId);
  const vehiclePhoto = useSignedImage("vehicle-photos", selected?.vehicle_photo_path ?? null);
  const driverPhoto = useSignedImage("driver-photos", selected?.photo_url ?? null);
  const legacyDriverPhoto = useSignedImage("avatars", selected?.profile?.avatar_url ?? null);
  const driverPhotoUrl = driverPhoto.data ?? legacyDriverPhoto.data ?? null;

  const filteredDrivers = useMemo(() => {
    const list = drivers.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((d) => {
      const name = `${d.profile?.first_name ?? ""} ${d.profile?.last_name ?? ""}`.toLowerCase();
      return name.includes(q) || (d.vehicle_plate ?? "").toLowerCase().includes(q);
    });
  }, [drivers.data, search]);

  const driverPos: LatLng | null =
    selected?.current_lat != null && selected?.current_lng != null
      ? { lat: selected.current_lat, lng: selected.current_lng }
      : null;
  const pickupPos: LatLng | null =
    trip.data?.pickup_lat != null && trip.data?.pickup_lng != null
      ? { lat: trip.data.pickup_lat, lng: trip.data.pickup_lng }
      : null;
  const dropoffPos: LatLng | null =
    trip.data?.dropoff_lat != null && trip.data?.dropoff_lng != null
      ? { lat: trip.data.dropoff_lat, lng: trip.data.dropoff_lng }
      : null;

  // Compute trip duration.
  const tripTime = useMemo(() => {
    if (!trip.data) return "—";
    const start = trip.data.actual_pickup_time ?? trip.data.scheduled_pickup_time;
    const end = trip.data.actual_dropoff_time ?? (trip.data.status === "in_progress" ? new Date().toISOString() : null);
    if (!start || !end) return "—";
    const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, [trip.data]);

  const tripMiles = trip.data?.gps_miles ?? trip.data?.computed_miles ?? null;
  const tripTone = trip.data ? statusTone(trip.data.status) : statusTone("scheduled");
  const driverTone = selected ? statusTone(selected.status) : statusTone("offline");

  const avgSpeed = useMemo(() => {
    if (!trip.data) return "—";
    const miles = Number(trip.data.gps_miles ?? trip.data.computed_miles ?? 0);
    const start = trip.data.actual_pickup_time ?? trip.data.scheduled_pickup_time;
    const end = trip.data.actual_dropoff_time;
    if (!miles || !start || !end) return "—";
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
    if (hours <= 0) return "—";
    return `${(miles / hours).toFixed(0)} mph`;
  }, [trip.data]);

  const fuelEstimate =
    tripMiles != null ? `${(Number(tripMiles) / 26).toFixed(1)} gal` : "—";

  return (
    <div className="fleet-shell -mx-4 -my-6 min-h-[calc(100vh-4rem)] px-4 py-6 md:-mx-6 md:-my-8 md:px-6 md:py-8">
      <div className="animate-rise-in space-y-6">
        {/* Header */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="min-w-0">
            <div className="truncate font-display text-2xl font-bold tracking-tight text-white">
              {selected
                ? `${selected.profile?.first_name ?? ""} ${selected.profile?.last_name ?? ""}`.trim() || "Driver"
                : "No driver selected"}
            </div>
            <div className="mt-1 text-xs font-medium text-white/50">
              {trip.data?.scheduled_pickup_time
                ? formatDateTime(trip.data.scheduled_pickup_time)
                : "No active trip"}
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${tripTone.classes}`}>
            {tripTone.label}
          </span>
        </header>

        {/* Vehicle + Driver profile + Drivers list */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {/* Premium vehicle card */}
          <div className="fleet-card fleet-card-hover group relative overflow-hidden">
            <div className="fleet-vehicle-canvas relative h-44 overflow-hidden p-4">
              {vehiclePhoto.data ? (
                <img
                  src={vehiclePhoto.data}
                  alt="Vehicle"
                  className="h-full w-full object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/45">
                  <Car className="h-14 w-14" />
                  <span className="text-[11px] font-medium">No vehicle photo</span>
                </div>
              )}
            </div>

            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-bold leading-tight text-white">
                    {selected?.vehicle_year ?? ""} {selected?.vehicle_make ?? "—"}{" "}
                    {selected?.vehicle_model ?? ""}
                  </div>
                  <div className="mt-1 flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${
                          i <= Math.round(Number(selected?.rating ?? 0))
                            ? "fill-[#F4C73D] text-[#F4C73D]"
                            : "text-white/25"
                        }`}
                      />
                    ))}
                    <span className="ml-1.5 text-[11px] text-white/60">
                      {selected?.total_ratings ?? 0}
                    </span>
                  </div>
                </div>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#D7264F]/90 text-white shadow-lg">
                  <Car className="h-5 w-5" />
                </div>
              </div>

              <div className="fleet-accent-line rounded-full" />

              <div className="space-y-2.5 text-sm">
                <VehicleRow tint="#F4C73D" label="Plate" value={selected?.vehicle_plate ?? "—"} />
                <VehicleRow tint="#D7264F" label="Trips" value={String(selected?.total_trips ?? 0)} />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-9 w-9 place-items-center rounded-full"
                      style={{ background: "#18B48A22", color: "#18B48A" }}
                    >
                      <Radio className="h-4 w-4" />
                    </span>
                    <span className="text-white/60">GPS</span>
                  </div>
                  <span
                    className={`flex items-center gap-2 text-sm font-semibold ${
                      driverPos ? "text-[#18B48A]" : "text-[#D7264F]"
                    }`}
                  >
                    {driverPos ? "Live" : "Offline"}
                    <span
                      className={`h-2 w-2 rounded-full ${driverPos ? "bg-[#18B48A] animate-pulse" : "bg-[#D7264F]"}`}
                    />
                  </span>
                </div>
              </div>
            </div>
            <div className="fleet-halftone pointer-events-none absolute inset-x-0 bottom-0 h-16" />
          </div>

          {/* Driver profile card */}
          <div className="fleet-card fleet-card-hover p-6">
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-white/10 ring-2 ring-white/15">
                {driverPhotoUrl ? (
                  <img src={driverPhotoUrl} alt="Driver" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-white/60">
                    {initials(selected?.profile?.first_name, selected?.profile?.last_name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-lg font-bold text-white">
                  {selected?.profile?.first_name} {selected?.profile?.last_name}
                </div>
                <div className="truncate text-xs text-white/50">
                  {selected?.profile?.email ?? "—"}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-white/50">
                  <span className="flex items-center gap-1 text-[#F4C73D]">
                    <Star className="h-3 w-3 fill-current" />
                    {selected?.rating ? Number(selected.rating).toFixed(2) : "—"}
                  </span>
                  <span>
                    Since{" "}
                    {selected?.profile?.created_at
                      ? new Date(selected.profile.created_at).getFullYear()
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-2.5 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-xs">
              <InfoRow label="Employee ID" value={selected?.id ? selected.id.slice(0, 8).toUpperCase() : "—"} />
              <InfoRow label="License" value="Active" valueClass="text-[#18B48A]" />
              <InfoRow
                label="Hire date"
                value={
                  selected?.profile?.created_at
                    ? new Date(selected.profile.created_at).toLocaleDateString()
                    : "—"
                }
              />
              <InfoRow label="Phone" value={selected?.profile?.phone || "—"} />
            </div>

            <Link
              to="/messages"
              className="btn-gradient-rb mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold"
            >
              <MessageSquare className="h-4 w-4" />
              Start a chat
            </Link>
          </div>

          {/* Drivers list */}
          <div className="fleet-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-white">Drivers</h2>
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-white/60">
                {filteredDrivers.length}
              </span>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search drivers"
                className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/35 transition focus:border-white/25 focus:outline-none"
              />
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {filteredDrivers.length === 0 && (
                <div className="py-10 text-center text-xs text-white/40">No drivers found.</div>
              )}
              {filteredDrivers.map((d) => {
                const tone = statusTone(d.status);
                const active = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 ${
                      active
                        ? "border-[#D7264F]/60 bg-[#D7264F]/10"
                        : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <Avatar
                      bucket="driver-photos"
                      path={d.photo_url ?? null}
                      fallbackPath={d.profile?.avatar_url ?? null}
                      name={`${d.profile?.first_name ?? ""} ${d.profile?.last_name ?? ""}`}
                      size={40}
                      className="bg-white/10"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold text-white">
                          {d.profile?.first_name} {d.profile?.last_name}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${tone.classes}`}>
                          {tone.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-white/45">
                        <span className="truncate">
                          {d.vehicle_year ?? ""} {d.vehicle_model ?? d.vehicle_make ?? "—"}
                        </span>
                        <span className="shrink-0">{d.total_trips ?? 0} trips</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <Link
              to="/trips"
              className="mt-4 flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-2.5 text-xs font-semibold text-white/80 transition hover:bg-white/[0.08]"
            >
              <History className="h-3.5 w-3.5" /> View history
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatPill tint="#1676B7" icon={<Clock className="h-4 w-4" />} label="Trip time" value={tripTime} />
          <StatPill
            tint="#18B48A"
            icon={<Gauge className="h-4 w-4" />}
            label="Miles driven"
            value={tripMiles != null ? Number(tripMiles).toFixed(1) : "—"}
          />
          <StatPill
            tint="#F4C73D"
            icon={<UsersIcon className="h-4 w-4" />}
            label="Passengers"
            value={trip.data ? "1" : "0"}
          />
          <StatPill tint="#D7264F" icon={<Gauge className="h-4 w-4" />} label="Avg speed" value={avgSpeed} />
          <StatPill tint="#1676B7" icon={<Fuel className="h-4 w-4" />} label="Fuel (est.)" value={fuelEstimate} />
        </div>

        {/* Map + trip stops */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="fleet-card relative h-[420px] overflow-hidden p-0">
            <DriverTripMap
              driver={driverPos}
              pickup={pickupPos}
              dropoff={dropoffPos}
              focus={driverPos}
              className="h-full w-full"
            />
            <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur">
              <span className={`h-2 w-2 rounded-full ${driverPos ? "bg-[#18B48A]" : "bg-[#D7264F]"}`} />
              {driverPos ? "Live tracking" : "No GPS signal"}
            </div>
          </div>
          <div className="fleet-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-white/45">
                Trip stops
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tripTone.classes}`}>
                {tripTone.label}
              </span>
            </div>
            {trip.data ? (
              <ol className="space-y-5">
                <StopRow
                  color="#18B48A"
                  label="Pickup"
                  time={trip.data.actual_pickup_time ?? trip.data.scheduled_pickup_time}
                  address={trip.data.pickup_address}
                  meta={trip.data.actual_pickup_time ? "Completed" : "Scheduled"}
                />
                <StopRow
                  color="#D7264F"
                  label="Dropoff"
                  time={trip.data.actual_dropoff_time}
                  address={trip.data.dropoff_address}
                  meta={
                    tripMiles != null ? `${Number(tripMiles).toFixed(1)} mi away` : "Awaiting arrival"
                  }
                  last
                />
              </ol>
            ) : (
              <div className="py-10 text-center text-xs text-white/40">
                No trip data for this driver.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleRow({ tint, label, value }: { tint: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-full text-[11px] font-bold"
          style={{ background: `${tint}22`, color: tint }}
        >
          <Circle className="h-3.5 w-3.5" fill="currentColor" />
        </span>
        <span className="text-white/60">{label}</span>
      </div>
      <span className="truncate font-semibold text-white">{value}</span>
    </div>
  );
}

function InfoRow({
  label,
  value,
  valueClass = "text-white",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/45">{label}</span>
      <span className={`truncate font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  tint = "#D7264F",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <div className="fleet-card fleet-card-hover flex items-center gap-3 p-4">
      <div
        className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
        style={{ background: `${tint}22`, color: tint }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-lg font-bold text-white">{value}</div>
        <div className="truncate text-[11px] text-white/45">{label}</div>
      </div>
    </div>
  );
}

function StopRow({
  color,
  label,
  time,
  address,
  meta,
  last,
}: {
  color: string;
  label: string;
  time: string | null | undefined;
  address: string | null | undefined;
  meta?: string;
  last?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className="mt-1 h-3 w-3 rounded-full ring-4"
          style={{ background: color, boxShadow: `0 0 0 4px ${color}22` }}
        />
        {!last && <div className="mt-1 h-full w-px bg-white/12" />}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45">
          <MapPin className="h-3 w-3" /> {label}
        </div>
        <div className="mt-1 text-sm text-white">{address ?? "—"}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/40">
          <span>{time ? formatDateTime(time) : "—"}</span>
          {meta && (
            <>
              <span className="h-1 w-1 rounded-full bg-white/25" />
              <span>{meta}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

