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

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-4rem)] bg-background px-4 py-6 text-foreground md:-mx-6 md:-my-8 md:px-6 md:py-8">
      <div className="space-y-5">
        {/* Header: current driver name + status */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-foreground">
              {selected ? `${selected.profile?.first_name ?? ""} ${selected.profile?.last_name ?? ""}`.trim() || "Driver" : "No driver selected"}
            </div>
            <div className="text-xs text-muted-foreground">
              {trip.data?.scheduled_pickup_time
                ? formatDateTime(trip.data.scheduled_pickup_time)
                : "No active trip"}
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${tripTone.classes}`}>
            {tripTone.label}
          </span>
        </header>

        {/* Vehicle + Driver profile + Drivers list */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {/* Vehicle card — slim */}
          <div className="vehicle-card-blue group relative overflow-hidden rounded-2xl ring-1 ring-border transition hover:shadow-lift">
            <div className="relative h-32 overflow-hidden p-2">
              {vehiclePhoto.data ? (
                <img
                  src={vehiclePhoto.data}
                  alt="Vehicle"
                  className="h-full w-full object-contain drop-shadow-md transition-transform duration-500 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Car className="h-12 w-12 text-white/90 drop-shadow" />
                </div>
              )}
            </div>

            <div className="space-y-2 p-3">
              <div>
                <div className="text-sm font-bold leading-tight text-white">
                  {selected?.vehicle_year ?? ""} {selected?.vehicle_make ?? "—"}{" "}
                  {selected?.vehicle_model ?? ""}
                </div>
                <div className="mt-0.5 flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      className={`h-3 w-3 ${
                        i <= Math.round(Number(selected?.rating ?? 0))
                          ? "fill-amber-400 text-amber-400"
                          : "text-white/40"
                      }`}
                    />
                  ))}
                  <span className="ml-1 text-[10px] text-white/80">
                    {selected?.total_ratings ?? 0}
                  </span>
                </div>
              </div>
              <div className="space-y-1 border-t border-white/20 pt-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-white/70">Plate</span>
                  <span className="font-semibold text-white">{selected?.vehicle_plate ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Trips</span>
                  <span className="font-semibold text-white">{selected?.total_trips ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">GPS</span>
                  <span className={`font-semibold ${driverPos ? "text-emerald-300" : "text-white/70"}`}>
                    {driverPos ? "Live" : "Offline"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Driver profile card */}
          <div className="rounded-2xl bg-card p-5 ring-1 ring-border">
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                {driverPhotoUrl ? (
                  <img src={driverPhotoUrl} alt="Driver" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
                    {initials(selected?.profile?.first_name, selected?.profile?.last_name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">
                  {selected?.profile?.first_name} {selected?.profile?.last_name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {selected?.profile?.email ?? "—"}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
                    <Star className="h-3 w-3 fill-current" />
                    {selected?.rating ? Number(selected.rating).toFixed(2) : "—"}
                  </span>
                  <span>Since {selected?.profile?.created_at ? new Date(selected.profile.created_at).getFullYear() : "—"}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2 rounded-xl bg-muted p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">License</span>
                <span className="font-medium text-foreground">Active</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hired</span>
                <span className="font-medium text-foreground">
                  {selected?.profile?.created_at
                    ? new Date(selected.profile.created_at).toLocaleDateString()
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span className="font-medium text-foreground">
                  {selected?.profile?.phone || "—"}
                </span>
              </div>
            </div>

            <Link
              to="/messages"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              <MessageSquare className="h-4 w-4" />
              Start a chat
            </Link>
          </div>

          {/* Drivers list — moved next to profile */}
          <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Drivers</h2>
              <span className="text-xs text-muted-foreground">{filteredDrivers.length}</span>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search drivers"
                className="w-full rounded-full bg-muted py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {filteredDrivers.length === 0 && (
                <div className="py-10 text-center text-xs text-muted-foreground">No drivers found.</div>
              )}
              {filteredDrivers.map((d) => {
                const tone = statusTone(d.status);
                const active = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${
                      active
                        ? "bg-brand-blue/10 ring-1 ring-brand-blue/40"
                        : "bg-muted/40 hover:bg-muted"
                    }`}
                  >
                    <Avatar
                      bucket="driver-photos"
                      path={d.photo_url ?? null}
                      fallbackPath={d.profile?.avatar_url ?? null}
                      name={`${d.profile?.first_name ?? ""} ${d.profile?.last_name ?? ""}`}
                      size={40}
                      className="bg-muted"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {d.profile?.first_name} {d.profile?.last_name}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${tone.classes}`}>
                          {tone.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
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
              className="mt-3 flex items-center justify-center gap-2 rounded-full bg-muted py-2 text-xs font-semibold text-foreground hover:bg-muted"
            >
              <History className="h-3.5 w-3.5" /> View history
            </Link>
          </div>
        </div>

        {/* Trip stats bar */}
        <div className="grid grid-cols-3 gap-3">
          <StatPill tone="blue" icon={<Clock className="h-4 w-4" />} label="Trip time" value={tripTime} />
          <StatPill
            tone="green"
            icon={<Gauge className="h-4 w-4" />}
            label="Miles driven"
            value={tripMiles != null ? Number(tripMiles).toFixed(1) : "—"}
          />
          <StatPill tone="yellow" icon={<UsersIcon className="h-4 w-4" />} label="Passengers" value={trip.data ? "1" : "0"} />
        </div>

        {/* Map + trip stops */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-[400px] overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <DriverTripMap
              driver={driverPos}
              pickup={pickupPos}
              dropoff={dropoffPos}
              focus={driverPos}
              className="h-full w-full"
            />
          </div>
          <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Trip stops
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tripTone.classes}`}>
                {tripTone.label}
              </span>
            </div>
            {trip.data ? (
              <ol className="space-y-4">
                <StopRow
                  dotClass="bg-emerald-400"
                  label="Pickup"
                  time={trip.data.actual_pickup_time ?? trip.data.scheduled_pickup_time}
                  address={trip.data.pickup_address}
                />
                <StopRow
                  dotClass="bg-rose-400"
                  label="Dropoff"
                  time={trip.data.actual_dropoff_time}
                  address={trip.data.dropoff_address}
                />
              </ol>
            ) : (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No trip data for this driver.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  tone = "red",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "red" | "blue" | "green" | "yellow";
}) {
  const toneMap: Record<string, string> = {
    red: "bg-brand-red/15 text-brand-red",
    blue: "bg-brand-blue/15 text-brand-blue",
    green: "bg-brand-green/15 text-brand-green",
    yellow: "bg-brand-yellow/25 text-brand-yellow-foreground dark:text-brand-yellow",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${toneMap[tone]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

function StopRow({
  dotClass,
  label,
  time,
  address,
}: {
  dotClass: string;
  label: string;
  time: string | null | undefined;
  address: string | null | undefined;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <Circle className={`h-3 w-3 rounded-full ${dotClass}`} fill="currentColor" />
        <div className="mt-1 h-full w-px bg-muted" />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <MapPin className="h-3 w-3" /> {label}
        </div>
        <div className="mt-1 text-sm text-foreground">{address ?? "—"}</div>
        <div className="text-[11px] text-muted-foreground">{time ? formatDateTime(time) : "—"}</div>
      </div>
    </li>
  );
}
