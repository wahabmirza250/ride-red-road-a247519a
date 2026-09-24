import { CompanyReadiness } from "@/components/admin/CompanyReadiness";
import { QueryNotice } from "@/components/admin/QueryNotice";
import { GoogleFleetMap } from "@/components/nemt/GoogleFleetMap";
import { locationState } from "@/lib/operationStatus";
import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { DriverTripMap, type LatLng } from "@/components/nemt/DriverTripMap";
import { EarningsPanel } from "@/components/admin/EarningsPanel";

import { Avatar } from "@/components/Avatar";
import {
  Search,
  Star,
  MapPin,
  Gauge,
  Clock,
  Users as UsersIcon,
  MessageSquare,
  History,
  Car,
  Fuel,
  Radio,
  Hash,
  Ticket,
  Phone,
  BadgeCheck,
  CalendarDays,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatDateTime } from "@/lib/format";
import type { ReactNode } from "react";

export const Route = createFileRoute("/$companySlug/_authenticated/dashboard")({
  validateSearch: (s: Record<string, unknown>): { driver?: string; view?: string } => ({
    driver: typeof s.driver === "string" ? s.driver : undefined,
    view: s.view === "setup" ? "setup" : undefined,
  }),
  component: DashboardPage,
});

type DriverListRow = {
  id: string;
  user_id: string;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
  last_location_at: string | null;
  license_number: string | null;
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
  source: "dispatch" | "report" | "draft" | "request";
};

const ACCENT = {
  red: "#E53958",
  blue: "#1683FF",
  green: "#18C98A",
  yellow: "#F6C344",
  violet: "#7B3FE4",
} as const;

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (["in_progress", "busy", "active", "available"].includes(s))
    return { label: "Active", tint: ACCENT.green };
  if (["completed", "done", "reviewed"].includes(s))
    return { label: "Completed", tint: ACCENT.blue };
  if (["scheduled", "pending", "assigned", "pending_review"].includes(s))
    return { label: "Scheduled", tint: ACCENT.yellow };
  return { label: status.replace(/_/g, " "), tint: "#8A93A5" };
}

function Chip({ label, tint }: { label: string; tint: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold capitalize"
      style={{
        background: `${tint}1F`,
        color: tint,
        boxShadow: `inset 0 0 0 1px ${tint}3D`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tint }} />
      {label}
    </span>
  );
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
          "id, user_id, status, current_lat, current_lng, last_location_at, license_number, photo_url, vehicle_photo_path, vehicle_make, vehicle_model, vehicle_year, vehicle_plate, default_vin, rating, total_trips, total_ratings",
        );
      if (error) throw error;
      const rows = data ?? [];
      const userIds = rows.map((r) => r.user_id).filter(Boolean);
      const profileMap = new Map<string, DriverListRow["profile"]>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, phone, avatar_url, created_at")
          .in("id", userIds)
          .throwOnError();
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
      const { data, error } = await supabase.rpc(
        "admin_trip_page" as never,
        { p_driver: driverId, p_status: "active" } as never,
      );
      if (error) throw error;
      const rows = (data as unknown as { rows: CurrentTrip[] }).rows;
      return rows[0] ?? null;
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

function DriverDetailPage() {
  const { driver: requestedDriver } = Route.useSearch();
  const drivers = useDrivers();
  const [selectedId, setSelectedId] = useState<string | null>(requestedDriver ?? null);
  const [search, setSearch] = useState("");

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

  const tripTime = useMemo(() => {
    if (!trip.data) return "—";
    const start = trip.data.actual_pickup_time ?? trip.data.scheduled_pickup_time;
    const end =
      trip.data.actual_dropoff_time ??
      (trip.data.status === "in_progress" ? new Date().toISOString() : null);
    if (!start || !end) return "—";
    const mins = Math.max(
      0,
      Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
    );
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, [trip.data]);

  const tripMiles = trip.data?.gps_miles ?? trip.data?.computed_miles ?? null;
  const tripTone = trip.data
    ? statusTone(trip.data.status)
    : { label: "No active trip", tint: "#8A93A5" };
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

  const fuelEstimate = tripMiles != null ? `${(Number(tripMiles) / 26).toFixed(1)} gal` : "—";

  const driverName =
    `${selected?.profile?.first_name ?? ""} ${selected?.profile?.last_name ?? ""}`.trim();

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <AppLink to="/dashboard" search={{}} className="text-sm text-primary underline">
        Back to Today
      </AppLink>
      <QueryNotice query={drivers} label="Drivers" />
      <QueryNotice query={trip} label="Current trip" />
      <div className="animate-rise-in space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] fleet-text-dim">
              Fleet <span className="opacity-40">/</span> Overview
            </div>
            <h1 className="mt-1 truncate font-display text-[26px] font-bold tracking-tight text-[color:var(--fleet-text)] sm:text-3xl">
              {driverName || (selected ? "Driver" : "No driver selected")}
            </h1>
            <p className="mt-1.5 text-xs font-medium fleet-text-muted">
              {trip.data?.scheduled_pickup_time
                ? formatDateTime(trip.data.scheduled_pickup_time)
                : "No active trip"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={driverTone.label} tint={driverTone.tint} />
            <Chip label={tripTone.label} tint={tripTone.tint} />
          </div>
        </header>

        {/* Row 1 — vehicle / driver / roster */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {/* Vehicle */}
          <div className="fleet-card fleet-card-hover group relative overflow-hidden">
            <div className="fleet-vehicle-canvas relative h-44 overflow-hidden p-4">
              {vehiclePhoto.data ? (
                <img
                  src={vehiclePhoto.data}
                  alt="Vehicle"
                  className="h-full w-full object-contain drop-shadow-[0_18px_28px_rgba(0,0,0,0.35)] transition-transform duration-500 group-hover:scale-[1.05]"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 fleet-text-dim">
                  <Car className="h-14 w-14" strokeWidth={1.25} />
                  <span className="text-[11px] font-medium">No vehicle photo</span>
                </div>
              )}
            </div>

            <div className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-bold leading-tight text-[color:var(--fleet-text)]">
                    {selected?.vehicle_year ?? ""} {selected?.vehicle_make ?? "—"}{" "}
                    {selected?.vehicle_model ?? ""}
                  </div>
                  <div className="mt-1.5 flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className="h-3.5 w-3.5"
                        style={{
                          color:
                            i <= Math.round(Number(selected?.rating ?? 0))
                              ? ACCENT.yellow
                              : "var(--fleet-dim)",
                          fill:
                            i <= Math.round(Number(selected?.rating ?? 0))
                              ? ACCENT.yellow
                              : "transparent",
                        }}
                      />
                    ))}
                    <span className="ml-2 text-[11px] fleet-text-muted">
                      {selected?.total_ratings ?? 0} ratings
                    </span>
                  </div>
                </div>
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{ background: `${ACCENT.red}1F`, color: ACCENT.red }}
                >
                  <Car className="h-5 w-5" />
                </div>
              </div>

              <div className="space-y-2.5">
                <VehicleRow
                  tint={ACCENT.yellow}
                  icon={<Hash className="h-4 w-4" />}
                  label="Plate"
                  value={selected?.vehicle_plate ?? "—"}
                />
                <VehicleRow
                  tint={ACCENT.red}
                  icon={<Ticket className="h-4 w-4" />}
                  label="Trips"
                  value={String(selected?.total_trips ?? 0)}
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-9 w-9 place-items-center rounded-full"
                      style={{ background: `${ACCENT.green}1F`, color: ACCENT.green }}
                    >
                      <Radio className="h-4 w-4" />
                    </span>
                    <span className="text-sm fleet-text-muted">GPS</span>
                  </div>
                  <span
                    className="flex items-center gap-2 text-sm font-semibold"
                    style={{ color: driverPos ? ACCENT.green : ACCENT.red }}
                  >
                    {locationState(selected)}
                    <span
                      className={`h-2 w-2 rounded-full ${driverPos ? "animate-pulse" : ""}`}
                      style={{ background: driverPos ? ACCENT.green : ACCENT.red }}
                    />
                  </span>
                </div>
              </div>
            </div>
            <div className="fleet-accent-line absolute inset-x-0 bottom-0" />
            <div className="fleet-halftone pointer-events-none absolute inset-x-0 bottom-0 h-16 opacity-60" />
          </div>

          {/* Driver profile */}
          <div className="fleet-card fleet-card-hover flex flex-col p-6">
            <div className="flex items-start gap-4">
              <div
                className="h-20 w-20 shrink-0 overflow-hidden rounded-full"
                style={{
                  background: "var(--fleet-panel-bg)",
                  boxShadow: "0 0 0 2px var(--fleet-border-strong)",
                }}
              >
                {driverPhotoUrl ? (
                  <img src={driverPhotoUrl} alt="Driver" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-semibold fleet-text-muted">
                    {initials(selected?.profile?.first_name, selected?.profile?.last_name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-lg font-bold text-[color:var(--fleet-text)]">
                  {driverName || "—"}
                </div>
                <div className="truncate text-xs fleet-text-muted">
                  {selected?.profile?.email ?? "—"}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ background: `${ACCENT.yellow}1F`, color: ACCENT.yellow }}
                  >
                    <Star className="h-3 w-3 fill-current" />
                    {selected?.rating ? Number(selected.rating).toFixed(2) : "—"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium fleet-text-muted fleet-panel">
                    <CalendarDays className="h-3 w-3" />
                    Since{" "}
                    {selected?.profile?.created_at
                      ? new Date(selected.profile.created_at).getFullYear()
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="fleet-panel mt-5 space-y-3 p-4 text-xs">
              <InfoRow
                icon={<Hash className="h-3.5 w-3.5" />}
                label="Employee ID"
                value={selected?.id ? selected.id.slice(0, 8).toUpperCase() : "—"}
              />
              <InfoRow
                icon={<BadgeCheck className="h-3.5 w-3.5" />}
                label="License"
                value={selected?.license_number ? "Unverified" : "Not provided"}
                tint={ACCENT.yellow}
              />
              <InfoRow
                icon={<CalendarDays className="h-3.5 w-3.5" />}
                label="Hire date"
                value={
                  selected?.profile?.created_at
                    ? new Date(selected.profile.created_at).toLocaleDateString()
                    : "—"
                }
              />
              <InfoRow
                icon={<Phone className="h-3.5 w-3.5" />}
                label="Phone"
                value={selected?.profile?.phone || "—"}
              />
            </div>

            <AppLink
              to="/messages"
              search={{ driver: selected?.user_id }}
              className="btn-gradient-rb mt-auto flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold"
              style={{ marginTop: "1.25rem" }}
            >
              <MessageSquare className="h-4 w-4" />
              Start a chat
            </AppLink>
          </div>

          {/* Driver roster */}
          <div className="fleet-card flex flex-col p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight text-[color:var(--fleet-text)]">
                Drivers
              </h2>
              <span className="fleet-panel rounded-full px-2.5 py-0.5 text-[11px] font-semibold fleet-text-muted">
                {filteredDrivers.length}
              </span>
            </div>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 fleet-text-dim" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search drivers"
                className="fleet-input w-full rounded-2xl py-3 pl-11 pr-4 text-sm"
              />
            </div>
            <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
              {filteredDrivers.length === 0 && (
                <div className="py-10 text-center text-xs fleet-text-dim">No drivers found.</div>
              )}
              {filteredDrivers.map((d) => {
                const tone = statusTone(d.status);
                const active = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`fleet-row flex w-full items-center gap-3 rounded-2xl p-3 text-left ${
                      active ? "fleet-row-active" : ""
                    }`}
                  >
                    <Avatar
                      bucket="driver-photos"
                      path={d.photo_url ?? null}
                      fallbackPath={d.profile?.avatar_url ?? null}
                      name={`${d.profile?.first_name ?? ""} ${d.profile?.last_name ?? ""}`}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold text-[color:var(--fleet-text)]">
                          {d.profile?.first_name} {d.profile?.last_name}
                        </div>
                        <Chip label={tone.label} tint={tone.tint} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] fleet-text-dim">
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
            <AppLink
              to="/trips"
              search={{ driver: selected?.id }}
              className="fleet-row mt-5 flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-semibold text-[color:var(--fleet-text)]"
            >
              <History className="h-3.5 w-3.5" /> View history
              <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
            </AppLink>
          </div>
        </div>

        {/* Earnings */}
        <AppLink to="/salary" className="block rounded-xl border p-4 text-primary">
          Review pay plans, unpaid work and payment history in Salary →
        </AppLink>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
          <StatCardX
            tint={ACCENT.blue}
            icon={<Clock className="h-[18px] w-[18px]" />}
            label="Trip time"
            value={tripTime}
          />
          <StatCardX
            tint={ACCENT.green}
            icon={<Gauge className="h-[18px] w-[18px]" />}
            label="Miles driven"
            value={tripMiles != null ? Number(tripMiles).toFixed(1) : "—"}
          />
          <StatCardX
            tint={ACCENT.yellow}
            icon={<UsersIcon className="h-[18px] w-[18px]" />}
            label="Passengers"
            value={trip.data ? "1" : "0"}
          />
          <StatCardX
            tint={ACCENT.red}
            icon={<Gauge className="h-[18px] w-[18px]" />}
            label="Avg speed"
            value={avgSpeed}
          />
          <StatCardX
            tint={ACCENT.violet}
            icon={<Fuel className="h-[18px] w-[18px]" />}
            label="Fuel (est.)"
            value={fuelEstimate}
          />
        </div>

        {/* Map + timeline */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="fleet-card relative h-[440px] overflow-hidden p-0">
            <DriverTripMap
              driver={driverPos}
              pickup={pickupPos}
              dropoff={dropoffPos}
              focus={driverPos}
              className="h-full w-full"
            />
            <div
              className="pointer-events-none absolute left-5 top-5 flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-semibold backdrop-blur"
              style={{
                background: "var(--fleet-card-bg)",
                border: "1px solid var(--fleet-border)",
                color: "var(--fleet-text)",
                boxShadow: "var(--fleet-shadow)",
              }}
            >
              <span
                className={`h-2 w-2 rounded-full ${driverPos ? "animate-pulse" : ""}`}
                style={{ background: driverPos ? ACCENT.green : ACCENT.red }}
              />
              {locationState(selected) === "Live" ? "Live tracking" : "Last known location"}
            </div>
          </div>

          <div className="fleet-card p-6">
            <div className="mb-5 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] fleet-text-dim">
                Trip stops
              </div>
              <Chip label={tripTone.label} tint={tripTone.tint} />
            </div>
            {trip.data ? (
              <ol className="space-y-3">
                <StopRow
                  color={ACCENT.green}
                  label="Pickup"
                  time={trip.data.actual_pickup_time ?? trip.data.scheduled_pickup_time}
                  address={trip.data.pickup_address}
                  meta={trip.data.actual_pickup_time ? "Completed" : "Scheduled"}
                />
                <StopRow
                  color={ACCENT.red}
                  label="Dropoff"
                  time={trip.data.actual_dropoff_time}
                  address={trip.data.dropoff_address}
                  meta={
                    tripMiles != null
                      ? `${Number(tripMiles).toFixed(1)} mi away`
                      : "Awaiting arrival"
                  }
                  last
                />
              </ol>
            ) : (
              <div className="py-10 text-center text-xs fleet-text-dim">
                No trip data for this driver.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleRow({
  tint,
  icon,
  label,
  value,
}: {
  tint: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-full"
          style={{ background: `${tint}1F`, color: tint }}
        >
          {icon}
        </span>
        <span className="text-sm fleet-text-muted">{label}</span>
      </div>
      <span className="truncate text-sm font-semibold text-[color:var(--fleet-text)]">{value}</span>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  tint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 fleet-text-dim">
        {icon}
        {label}
      </span>
      <span className="truncate font-semibold" style={{ color: tint ?? "var(--fleet-text)" }}>
        {value}
      </span>
    </div>
  );
}

function StatCardX({
  icon,
  label,
  value,
  tint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <div className="fleet-card fleet-card-hover flex items-center gap-3.5 p-5">
      <div
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
        style={{ background: `${tint}1F`, color: tint }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xl font-bold tabular-nums text-[color:var(--fleet-text)]">
          {value}
        </div>
        <div className="truncate text-[11px] font-medium fleet-text-muted">{label}</div>
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
      <div className="flex flex-col items-center pt-4">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 0 4px ${color}26` }}
        />
        {!last && (
          <div className="mt-1 w-px flex-1" style={{ background: "var(--fleet-border-strong)" }} />
        )}
      </div>
      <div className="fleet-row min-w-0 flex-1 rounded-2xl p-3.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] fleet-text-dim">
          <MapPin className="h-3 w-3" /> {label}
        </div>
        <div className="mt-1.5 text-sm font-medium text-[color:var(--fleet-text)]">
          {address ?? "—"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] fleet-text-dim">
          <span>{time ? formatDateTime(time) : "—"}</span>
          {meta && (
            <>
              <span className="h-1 w-1 rounded-full" style={{ background: "var(--fleet-dim)" }} />
              <span>{meta}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function DashboardPage() {
  const search = Route.useSearch();
  if (search.driver) return <DriverDetailPage key={search.driver} />;
  return <TodayPage setupOnly={search.view === "setup"} />;
}
function TodayPage({ setupOnly }: { setupOnly: boolean }) {
  const drivers = useDrivers();
  const queue = useQuery({
    queryKey: ["today-queues"],
    refetchInterval: 15000,
    queryFn: async () => {
      const read = async (status: string) => {
        const { data, error } = await supabase.rpc(
          "admin_trip_page" as never,
          { p_status: status } as never,
        );
        if (error) throw error;
        return data as unknown as {
          count: number;
          rows: Array<{
            id: string;
            source: string;
            scheduled_pickup_time: string;
            passenger_name: string;
            driver_name: string;
            pickup_address: string;
            driver_id: string | null;
          }>;
        };
      };
      const [unassigned, overdue, active, scheduled] = await Promise.all(
        ["unassigned", "overdue", "active", "next"].map(read),
      );
      return { unassigned, overdue, active, scheduled };
    },
  });
  if (setupOnly)
    return (
      <div className="space-y-4">
        <AppLink to="/dashboard" search={{}} className="text-primary underline">
          Back to Today
        </AppLink>
        <CompanyReadiness />
      </div>
    );
  const markers = (drivers.data ?? [])
    .filter((d) => d.current_lat != null && d.current_lng != null)
    .map((d) => ({
      id: d.id,
      lat: d.current_lat!,
      lng: d.current_lng!,
      status:
        locationState(d) === "Live"
          ? (d.status as "available" | "busy" | "offline")
          : ("offline" as const),
      label: [d.profile?.first_name, d.profile?.last_name].filter(Boolean).join(" "),
    }));
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Today</h1>
          <p className="text-sm text-muted-foreground">
            Pickups, driver availability and work that needs attention.
          </p>
        </div>
        <AppLink
          to="/dashboard"
          search={{ view: "setup" }}
          className="rounded-xl border px-4 py-2 text-sm"
        >
          Company setup
        </AppLink>
      </header>
      <QueryNotice query={queue} label="Operations" />
      <QueryNotice query={drivers} label="Driver locations" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            { key: "unassigned", label: "Unassigned rides" },
            { key: "overdue", label: "Overdue pickups" },
            { key: "active", label: "Active trips" },
            { key: "scheduled", label: "Upcoming pickups" },
          ] as const
        ).map((c) => (
          <AppLink
            key={c.key}
            to="/trips"
            search={{ status: c.key === "scheduled" ? "next" : c.key }}
            className="rounded-2xl border bg-surface p-4"
          >
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-3xl font-semibold">
              {queue.isError ? "Unavailable" : (queue.data?.[c.key].count ?? "…")}
            </p>
          </AppLink>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="overflow-hidden rounded-2xl border bg-surface">
          <div className="flex flex-wrap justify-between gap-2 p-4">
            <h2 className="font-semibold">Fleet location</h2>
            <span className="text-xs text-muted-foreground">
              {drivers.isError
                ? "Location unavailable"
                : `${(drivers.data ?? []).filter((d) => locationState(d) === "Live").length} current · ${(drivers.data ?? []).filter((d) => locationState(d) !== "Live").length} need a location update`}
            </span>
          </div>
          <div className="relative z-0 h-[340px]">
            <GoogleFleetMap center={[39.7392, -104.9903]} markers={markers} />
          </div>
          <p className="p-3 text-xs text-muted-foreground">
            GPS becomes stale after 90 seconds. Gray pins are last known positions.
          </p>
        </section>
        <section className="rounded-2xl border bg-surface p-4">
          <h2 className="mb-3 font-semibold">Needs attention</h2>
          {queue.isPending ? (
            <p>Loading…</p>
          ) : queue.isError ? (
            <p>Queue unavailable. Retry above.</p>
          ) : (
            <>
              <AppLink
                to="/trips"
                search={{ status: "overdue" }}
                className="block rounded-xl border p-3"
              >
                Review {queue.data?.overdue.count} overdue pickups
              </AppLink>
              <AppLink
                to="/trips"
                search={{ status: "unassigned" }}
                className="mt-2 block rounded-xl border p-3"
              >
                Assign {queue.data?.unassigned.count} waiting rides
              </AppLink>
            </>
          )}
          <AppLink
            to="/medicaid-billing/hcpf"
            search={{ tab: "workflow" }}
            className="mt-2 block rounded-xl border p-3"
          >
            Review billing queue and blocked claims
          </AppLink>
          <AppLink to="/compliance" className="mt-2 block rounded-xl border p-3">
            Review driver documents and expiry alerts
          </AppLink>
          <AppLink
            to="/live-ops"
            search={{ tab: "plan" }}
            className="mt-2 block rounded-xl border p-3"
          >
            Plan upcoming pickups
          </AppLink>
        </section>
      </div>
      <section className="rounded-2xl border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Next pickups</h2>
        {queue.data?.scheduled.rows.slice(0, 5).map((t) => (
          <AppLink
            key={t.source + t.id}
            to="/trips"
            search={{ q: t.id }}
            className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm"
          >
            <span>
              {t.passenger_name || "Passenger"} · {t.pickup_address}
            </span>
            <span>
              {formatDateTime(t.scheduled_pickup_time)} · {t.driver_name}
            </span>
          </AppLink>
        ))}
        {queue.data && !queue.data.scheduled.count && (
          <p className="text-sm text-muted-foreground">No upcoming pickups.</p>
        )}
      </section>
      <section className="rounded-2xl border bg-surface p-4">
        <div className="mb-3 flex justify-between gap-2">
          <h2 className="font-semibold">Drivers and device health</h2>
          <AppLink to="/drivers" className="text-sm text-primary underline">
            Manage drivers
          </AppLink>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {drivers.data?.map((d) => (
            <AppLink
              key={d.id}
              to="/dashboard"
              search={{ driver: d.id }}
              className="rounded-xl border p-3"
            >
              <h3 className="font-medium">
                {[d.profile?.first_name, d.profile?.last_name].filter(Boolean).join(" ") ||
                  "Driver"}
              </h3>
              <p className="text-sm">
                {d.status} · GPS {locationState(d)}
              </p>
              <p className="text-xs text-muted-foreground">
                {d.last_location_at
                  ? "Last update " + formatDateTime(d.last_location_at)
                  : "No location received"}
              </p>
              <p className="mt-2 text-xs text-primary">Open driver operations →</p>
            </AppLink>
          ))}
        </div>
        {!drivers.isPending && !drivers.isError && !drivers.data?.length && (
          <p>No drivers yet. Add a driver to connect a company tablet.</p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        {queue.dataUpdatedAt
          ? "Operations last refreshed " + new Date(queue.dataUpdatedAt).toLocaleTimeString()
          : "Waiting for the first successful update."}
      </p>
    </div>
  );
}
