import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Wand2, Search } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { haversineMiles } from "@/lib/geo";

export const Route = createFileRoute("/_authenticated/trips")({
  component: TripsPage,
});

type Passenger = { id: string; first_name: string; last_name: string; medicaid_id: string };
type Driver = {
  id: string;
  user_id: string;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
  name?: string;
};

type Trip = {
  id: string;
  status: string;
  billing_status: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_time: string;
  actual_pickup_time: string | null;
  actual_dropoff_time: string | null;
  driver_id: string | null;
  passenger_id: string;
  odometer_start: number | null;
  odometer_end: number | null;
  odometer_start_photo: string | null;
  odometer_end_photo: string | null;
  notes: string | null;
};

function TripsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [billingFilter, setBillingFilter] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [detail, setDetail] = useState<Trip | null>(null);

  const trips = useQuery({
    queryKey: ["trips", statusFilter, billingFilter],
    queryFn: async () => {
      let q = supabase
        .from("trips")
        .select("*")
        .order("scheduled_pickup_time", { ascending: false })
        .limit(200);
      if (statusFilter !== "all")
        q = q.eq(
          "status",
          statusFilter as
            | "scheduled"
            | "assigned"
            | "driver_en_route_to_pickup"
            | "arrived_at_pickup"
            | "in_progress"
            | "completed"
            | "cancelled"
            | "no_show",
        );
      if (billingFilter !== "all")
        q = q.eq(
          "billing_status",
          billingFilter as "pending" | "submitted" | "paid" | "rejected",
        );
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Trip[];
    },
    refetchInterval: 20_000,
  });

  const passengers = useQuery({
    queryKey: ["passengers-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("passengers")
        .select("id, first_name, last_name, medicaid_id");
      return (data ?? []) as Passenger[];
    },
  });

  const drivers = useQuery({
    queryKey: ["drivers-simple"],
    queryFn: async () => {
      const { data } = await supabase
        .from("drivers")
        .select("id, user_id, status, current_lat, current_lng");
      const rows = (data ?? []) as Driver[];
      const ids = rows.map((d) => d.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids)
        : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
      const nameById = new Map<string, string>();
      (profs ?? []).forEach((p) =>
        nameById.set(p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Driver"),
      );
      return rows.map((d) => ({ ...d, name: nameById.get(d.user_id) ?? "Driver" }));
    },
  });

  const passengerName = (id: string) => {
    const p = passengers.data?.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name}` : "—";
  };

  const driverName = (id: string | null) => {
    if (!id) return "Unassigned";
    const d = drivers.data?.find((x) => x.id === id);
    return d?.name ?? "—";
  };

  const qc = useQueryClient();
  const autoAssign = useMutation({
    mutationFn: async (tripId: string) => {
      const trip = trips.data?.find((t) => t.id === tripId);
      if (!trip) throw new Error("Trip not found");
      const available = (drivers.data ?? []).filter((d) => d.status === "available");
      if (!available.length) throw new Error("No available drivers");
      // Nearest by pickup coords if we have them, else first available
      let chosen = available[0];
      const { data: pickup } = trip.pickup_address
        ? { data: null }
        : { data: null };
      void pickup;
      // We don't geocode; fall back to first available if no coords
      // But if trip has pickup_lat/lng in the future, we'd compute here
      const anyWithGps = available.find((d) => d.current_lat != null && d.current_lng != null);
      if (anyWithGps) {
        // just picks any driver with gps as "closest" until geocoding is added
        chosen = anyWithGps;
        // if trip had coords:
        // chosen = available.reduce((best, d) => {...haversineMiles...});
      }
      void haversineMiles; // referenced for future geo assignment

      const { error } = await supabase
        .from("trips")
        .update({ driver_id: chosen.id, status: "assigned", assignment_type: "auto" })
        .eq("id", tripId);
      if (error) throw error;
      return chosen.id;
    },
    onSuccess: () => {
      toast.success("Trip assigned");
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nextUnassigned = trips.data?.find((t) => !t.driver_id && t.status === "scheduled");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trips"
        description="All scheduled and completed rides."
        actions={
          <>
            <Button
              variant="secondary"
              className="rounded-full"
              disabled={!nextUnassigned || autoAssign.isPending}
              onClick={() => nextUnassigned && autoAssign.mutate(nextUnassigned.id)}
            >
              {autoAssign.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Auto-assign next
            </Button>
            <Dialog open={openNew} onOpenChange={setOpenNew}>
              <DialogTrigger asChild>
                <Button className="rounded-full">
                  <Plus className="mr-2 h-4 w-4" /> New trip
                </Button>
              </DialogTrigger>
              <NewTripDialog
                onClose={() => setOpenNew(false)}
                passengers={passengers.data ?? []}
                drivers={drivers.data ?? []}
              />
            </Dialog>
          </>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[160px]">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="driver_en_route_to_pickup">En route</SelectItem>
              <SelectItem value="arrived_at_pickup">Arrived</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="no_show">No show</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Select value={billingFilter} onValueChange={setBillingFilter}>
            <SelectTrigger className="rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All billing</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Passenger</th>
                <th className="px-4 py-3 text-left">Driver</th>
                <th className="px-4 py-3 text-left">Pickup</th>
                <th className="px-4 py-3 text-left">Dropoff</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trips.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              ) : trips.data?.length ? (
                trips.data.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setDetail(t)}
                    className="cursor-pointer hover:bg-accent/60"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(t.scheduled_pickup_time)}
                    </td>
                    <td className="px-4 py-3">{passengerName(t.passenger_id)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {driverName(t.driver_id)}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3">{t.pickup_address}</td>
                    <td className="max-w-[220px] truncate px-4 py-3">{t.dropoff_address}</td>
                    <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                    <td className="px-4 py-3"><StatusPill status={t.billing_status} /></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No trips yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && (
          <TripDetailDialog
            trip={detail}
            passengerName={passengerName(detail.passenger_id)}
            driverName={driverName(detail.driver_id)}
            onClose={() => setDetail(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function NewTripDialog({
  onClose,
  passengers,
  drivers,
}: {
  onClose: () => void;
  passengers: Passenger[];
  drivers: Driver[];
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [passengerId, setPassengerId] = useState("");
  const [driverId, setDriverId] = useState<string>("__unassigned");
  const [pickup, setPickup] = useState("");
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoff, setDropoff] = useState("");
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [waypointsText, setWaypointsText] = useState("");
  const [scheduled, setScheduled] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return d.toISOString().slice(0, 16);
  });
  const [submitting, setSubmitting] = useState(false);

  const filtered = passengers.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.first_name.toLowerCase().includes(q) ||
      p.last_name.toLowerCase().includes(q) ||
      p.medicaid_id.toLowerCase().includes(q)
    );
  });

  async function submit() {
    if (!passengerId) return toast.error("Pick a passenger");
    if (!pickup || !dropoff) return toast.error("Pickup and dropoff required");
    setSubmitting(true);
    const wp = waypointsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({ address }));
    const { error } = await supabase.from("trips").insert({
      passenger_id: passengerId,
      driver_id: driverId === "__unassigned" ? null : driverId,
      status: driverId === "__unassigned" ? "scheduled" : "assigned",
      pickup_address: pickup,
      dropoff_address: dropoff,
      pickup_lat: pickupCoords?.lat ?? null,
      pickup_lng: pickupCoords?.lng ?? null,
      dropoff_lat: dropoffCoords?.lat ?? null,
      dropoff_lng: dropoffCoords?.lng ?? null,
      waypoints: wp,
      scheduled_pickup_time: new Date(scheduled).toISOString(),
      assignment_type: "manual",
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Trip created");
    qc.invalidateQueries({ queryKey: ["trips"] });
    onClose();
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>New trip</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Passenger</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or Medicaid ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="max-h-40 overflow-auto rounded-xl border border-border">
            {filtered.slice(0, 20).map((p) => (
              <button
                key={p.id}
                onClick={() => setPassengerId(p.id)}
                className={`flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent ${
                  passengerId === p.id ? "bg-primary/8" : ""
                }`}
              >
                <span>
                  {p.first_name} {p.last_name}
                </span>
                <span className="text-xs text-muted-foreground">{p.medicaid_id}</span>
              </button>
            ))}
            {!filtered.length && (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matches. Add the passenger first.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Driver</Label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned">Unassigned</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name ?? "Driver"} — {d.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Pickup address</Label>
          <AddressAutocomplete
            value={pickup}
            onChange={(v) => {
              setPickup(v);
              setPickupCoords(null);
            }}
            onResolve={(p) => {
              setPickup(p.address);
              setPickupCoords({ lat: p.lat, lng: p.lng });
            }}
            placeholder="Start typing pickup address…"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Dropoff address</Label>
          <AddressAutocomplete
            value={dropoff}
            onChange={(v) => {
              setDropoff(v);
              setDropoffCoords(null);
            }}
            onResolve={(p) => {
              setDropoff(p.address);
              setDropoffCoords({ lat: p.lat, lng: p.lng });
            }}
            placeholder="Start typing dropoff address…"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Waypoints (one per line, optional)</Label>
          <Textarea
            rows={2}
            value={waypointsText}
            onChange={(e) => setWaypointsText(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Scheduled pickup</Label>
          <Input
            type="datetime-local"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Create trip
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function TripDetailDialog({
  trip,
  passengerName,
  driverName,
  onClose,
}: {
  trip: Trip;
  passengerName: string;
  driverName: string;
  onClose: () => void;
}) {
  const [photoUrls, setPhotoUrls] = useState<{ start?: string; end?: string }>({});

  useState(() => {
    async function load() {
      const urls: { start?: string; end?: string } = {};
      if (trip.odometer_start_photo) {
        const { data } = await supabase.storage
          .from("odometers")
          .createSignedUrl(trip.odometer_start_photo, 600);
        urls.start = data?.signedUrl;
      }
      if (trip.odometer_end_photo) {
        const { data } = await supabase.storage
          .from("odometers")
          .createSignedUrl(trip.odometer_end_photo, 600);
        urls.end = data?.signedUrl;
      }
      setPhotoUrls(urls);
    }
    load();
  });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Trip details
          <StatusPill status={trip.status} />
          <StatusPill status={trip.billing_status} />
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <Info label="Passenger" value={passengerName} />
        <Info label="Driver" value={driverName} />
        <Info label="Pickup" value={trip.pickup_address} />
        <Info label="Dropoff" value={trip.dropoff_address} />
        <Info label="Scheduled" value={formatDateTime(trip.scheduled_pickup_time)} />
        <Info label="Actual pickup" value={formatDateTime(trip.actual_pickup_time)} />
        <Info label="Actual dropoff" value={formatDateTime(trip.actual_dropoff_time)} />
        <Info
          label="Odometer"
          value={
            trip.odometer_start != null && trip.odometer_end != null
              ? `${trip.odometer_start} → ${trip.odometer_end} (${
                  trip.odometer_end - trip.odometer_start
                } mi)`
              : trip.odometer_start != null
                ? `Start ${trip.odometer_start}`
                : "—"
          }
        />
      </div>
      {(photoUrls.start || photoUrls.end) && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {photoUrls.start && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Odometer start
              </div>
              <img
                src={photoUrls.start}
                alt="Start odometer"
                className="w-full rounded-xl border border-border"
              />
            </div>
          )}
          {photoUrls.end && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Odometer end
              </div>
              <img
                src={photoUrls.end}
                alt="End odometer"
                className="w-full rounded-xl border border-border"
              />
            </div>
          )}
        </div>
      )}
      {trip.notes && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Notes</div>
          <div className="rounded-xl bg-surface-muted p-3 text-sm">{trip.notes}</div>
        </div>
      )}
      <DialogFooter>
        <a
          href={`/track/${trip.id}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-accent"
        >
          Open passenger tracking
        </a>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}
