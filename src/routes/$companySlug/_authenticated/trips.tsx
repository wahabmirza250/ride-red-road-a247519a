import { useServerFn } from "@tanstack/react-start";
import { AppLink, useAppNavigate } from "@/lib/appLink";
import { QueryNotice } from "@/components/admin/QueryNotice";
import { assignAdminTrip, nextAdminAssignment } from "@/lib/adminAssignment.functions";
import { localDateTimeInput, localInputToISOString } from "@/lib/operationStatus";
import { PassengerFormDialog } from "./passengers";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { TripReportEditor } from "@/components/nemt/TripReportEditor";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Wand2, Search, Trash2, FileText } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/errorMessage";
import { haversineMiles } from "@/lib/geo";

type Passenger = { id: string; first_name: string; last_name: string; medicaid_id: string | null };
type Driver = {
  id: string;
  user_id: string;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
  name?: string;
};

type Trip = {
  source: "dispatch" | "report" | "draft" | "request";
  passenger_name: string;
  driver_name: string;
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
  round_trip_group_id: string | null;
  round_trip_leg: number | null;
};

export const Route = createFileRoute("/$companySlug/_authenticated/trips")({
  validateSearch: (s: Record<string, unknown>) => ({
    status: typeof s.status === "string" ? s.status : "all",
    billing: typeof s.billing === "string" ? s.billing : "all",
    driver: typeof s.driver === "string" ? s.driver : "",
    q: typeof s.q === "string" ? s.q : "",
    from: typeof s.from === "string" ? s.from : "",
    to: typeof s.to === "string" ? s.to : "",
    page: Math.max(0, Math.floor(Number(s.page) || 0)),
  }),
  component: TripsPage,
});
function TripsPage() {
  const search = Route.useSearch();
  const navigate = useAppNavigate();
  const qc = useQueryClient();
  const update = (patch: Record<string, unknown>) =>
    navigate({ to: "/trips", search: { ...search, page: 0, ...patch } });
  const [openNew, setOpenNew] = useState(false);
  const [detail, setDetail] = useState<Trip | null>(null);
  const assignment = useServerFn(assignAdminTrip);
  const nextAssignment = useServerFn(nextAdminAssignment);
  const [proposal, setProposal] = useState<
    (Awaited<ReturnType<typeof assignAdminTrip>> & { source: "dispatch" | "request" }) | null
  >(null);
  const [assigning, setAssigning] = useState(false);
  const trips = useQuery({
    queryKey: ["trips", search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_trip_page" as never,
        {
          p_page: search.page,
          p_search: search.q,
          p_status: search.status,
          p_billing: search.billing,
          p_driver: search.driver || null,
          p_from: search.from ? localInputToISOString(search.from + "T00:00") : null,
          p_to: search.to ? localInputToISOString(search.to + "T00:00") : null,
        } as never,
      );
      if (error) throw error;
      return data as unknown as { rows: Trip[]; count: number };
    },
    refetchInterval: 20000,
  });
  const passengers = useQuery({
    queryKey: ["passengers-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passengers")
        .select("id,first_name,last_name,medicaid_id")
        .eq("is_active", true)
        .order("first_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const drivers = useQuery({
    queryKey: ["drivers-simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id,user_id,status,current_lat,current_lng");
      if (error) throw error;
      const ids = (data ?? []).map((d) => d.user_id);
      const profiles = ids.length
        ? await supabase.from("profiles").select("id,first_name,last_name").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      return (data ?? []).map((d) => ({
        ...d,
        name:
          profiles.data
            ?.filter((p) => p.id === d.user_id)
            .map((p) => [p.first_name, p.last_name].filter(Boolean).join(" "))[0] ?? "Driver",
      }));
    },
  });
  async function preview() {
    setAssigning(true);
    try {
      const next = await nextAssignment();
      const p = await assignment({
        data: { trip_id: next.id, source: next.source, preview: true, driver_id: null },
      });
      setProposal({ ...p, source: next.source });
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Could not preview assignment"));
    } finally {
      setAssigning(false);
    }
  }
  async function confirm() {
    if (!proposal) return;
    setAssigning(true);
    try {
      await assignment({
        data: {
          trip_id: proposal.trip_id,
          driver_id: proposal.driver_id,
          source: proposal.source,
          preview: false,
        },
      });
      toast.success("Assignment saved");
      setProposal(null);
      void qc.invalidateQueries({ queryKey: ["trips"] });
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Availability changed. Review the assignment again."));
      setProposal(null);
    } finally {
      setAssigning(false);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader
        title="Trips"
        description="Scheduled rides, driver work and completed reports. Linked billing reports are labeled separately."
        actions={
          <>
            <Button variant="secondary" disabled={assigning} onClick={preview}>
              Review next assignment
            </Button>
            <Button onClick={() => setOpenNew(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New trip
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs">
          Search trips
          <Input
            value={search.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Passenger, driver, address or ID"
          />
        </label>
        <label className="text-xs">
          Status
          <select
            className="h-10 w-full rounded-lg border bg-background px-2"
            value={search.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            {[
              "all",
              "next",
              "unassigned",
              "overdue",
              "active",
              "scheduled",
              "assigned",
              "in_progress",
              "completed",
              "draft",
              "cancelled",
              "no_show",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Driver
          <select
            className="h-10 w-full rounded-lg border bg-background px-2"
            value={search.driver}
            onChange={(e) => update({ driver: e.target.value })}
          >
            <option value="">All drivers</option>
            {drivers.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Billing
          <select
            className="h-10 w-full rounded-lg border bg-background px-2"
            value={search.billing}
            onChange={(e) => update({ billing: e.target.value })}
          >
            {[
              "all",
              "not_submitted",
              "pending",
              "pending_review",
              "approved",
              "submitted",
              "paid",
              "needs_fix",
              "rejected",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          From
          <Input
            type="date"
            value={search.from}
            onChange={(e) => update({ from: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Before
          <Input type="date" value={search.to} onChange={(e) => update({ to: e.target.value })} />
        </label>
      </div>
      <QueryNotice query={trips} label="Trips" />
      <QueryNotice query={drivers} label="Drivers" />
      <QueryNotice query={passengers} label="Passengers" />
      <div className="overflow-x-auto rounded-xl border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "Pickup / record time",
                "Source",
                "Passenger",
                "Driver",
                "Route",
                "Status",
                "Billing",
              ].map((s) => (
                <th className="p-3 text-left" key={s}>
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trips.isPending ? (
              <tr>
                <td colSpan={7} className="p-6">
                  Loading trips…
                </td>
              </tr>
            ) : (
              trips.data?.rows.map((t) => (
                <tr key={t.source + ":" + t.id} className="border-t hover:bg-accent/50">
                  <td className="p-3">
                    <button
                      onClick={() => setDetail(t)}
                      className="whitespace-nowrap text-primary underline"
                    >
                      {formatDateTime(t.scheduled_pickup_time)}
                    </button>
                  </td>
                  <td className="p-3 capitalize">{t.source}</td>
                  <td className="p-3">{t.passenger_name || "Passenger"}</td>
                  <td className="p-3">{t.driver_name}</td>
                  <td className="min-w-48 p-3">
                    {t.pickup_address}
                    <br />
                    <span className="text-muted-foreground">→ {t.dropoff_address}</span>
                  </td>
                  <td className="p-3">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="p-3">
                    <StatusPill status={t.billing_status} />
                  </td>
                </tr>
              ))
            )}
            {!trips.isPending && !trips.isError && !trips.data?.rows.length && (
              <tr>
                <td colSpan={7} className="p-6">
                  No trips match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>
          {trips.isError
            ? "Count unavailable"
            : trips.data
              ? trips.data.count +
                " records · Page " +
                (search.page + 1) +
                " of " +
                Math.max(1, Math.ceil(trips.data.count / 50))
              : "Loading count…"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!search.page}
            onClick={() => update({ page: search.page - 1 })}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!trips.data || 50 * (search.page + 1) >= trips.data.count}
            onClick={() => update({ page: search.page + 1 })}
          >
            Next
          </Button>
        </div>
      </div>
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <NewTripDialog
          onClose={() => setOpenNew(false)}
          passengers={passengers.data ?? []}
          drivers={drivers.data ?? []}
        />
      </Dialog>
      <Dialog open={!!proposal} onOpenChange={(o) => !o && setProposal(null)}>
        <DialogContent>
          <DialogTitle>Confirm assignment</DialogTitle>
          <p>
            {proposal?.pickup} → {proposal?.dropoff}
          </p>
          <p>
            Driver:{" "}
            {drivers.data?.find((d) => d.id === proposal?.driver_id)?.name ?? proposal?.driver_id}
          </p>
          <p className="text-sm text-muted-foreground">
            {proposal?.rule}. Availability will be checked again when you confirm. Group rides
            require vehicle planning in Dispatch.
          </p>
          <Button disabled={assigning} onClick={confirm}>
            Confirm assignment
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail?.source === "dispatch" ? (
          <TripDetailDialog
            trip={detail}
            passengerName={detail.passenger_name}
            driverName={detail.driver_name}
            onClose={() => setDetail(null)}
            onDeleted={() => {
              setDetail(null);
              void qc.invalidateQueries({ queryKey: ["trips"] });
            }}
          />
        ) : (
          detail && (
            <DialogContent>
              <DialogTitle>
                {detail.source === "draft"
                  ? "Driver work in progress"
                  : detail.source === "request"
                    ? "Ride request"
                    : "Completed trip report"}
              </DialogTitle>
              <p>
                {detail.passenger_name} · {detail.driver_name}
              </p>
              <p>
                {detail.pickup_address} → {detail.dropoff_address}
              </p>
              <p>{formatDateTime(detail.scheduled_pickup_time)}</p>
              <p>{detail.notes}</p>
              <p>
                Trip: {detail.status.replaceAll("_", " ")} · Billing:{" "}
                {detail.billing_status.replaceAll("_", " ")}
              </p>
              {detail.source === "report" ? (
                <AppLink to={"/medicaid-trips/" + detail.id} className="text-primary underline">
                  Open report and billing details
                </AppLink>
              ) : (
                <AppLink to="/live-ops" className="text-primary underline">
                  Open Dispatch
                </AppLink>
              )}
            </DialogContent>
          )
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
  const [addingPassenger, setAddingPassenger] = useState(false);
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
    return localDateTimeInput(d);
  });
  const [submitting, setSubmitting] = useState(false);

  const filtered = passengers.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.first_name.toLowerCase().includes(q) ||
      p.last_name.toLowerCase().includes(q) ||
      (p.medicaid_id ?? "").toLowerCase().includes(q)
    );
  });

  async function submit() {
    if (!passengerId) return toast.error("Pick a passenger");
    if (!pickup || !dropoff) return toast.error("Pickup and dropoff required");
    let scheduledISO: string;
    try {
      scheduledISO = localInputToISOString(scheduled);
    } catch (e) {
      return toast.error(friendlyErrorMessage(e, "Invalid pickup time"));
    }
    setSubmitting(true);
    const wp = waypointsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({ address }));
    const { error } = await supabase.from("trips").insert({
      passenger_id: passengerId,
      driver_id: null,
      status: "scheduled",
      pickup_address: pickup,
      dropoff_address: dropoff,
      pickup_lat: pickupCoords?.lat ?? null,
      pickup_lng: pickupCoords?.lng ?? null,
      dropoff_lat: dropoffCoords?.lat ?? null,
      dropoff_lng: dropoffCoords?.lng ?? null,
      waypoints: wp,
      scheduled_pickup_time: scheduledISO,
      assignment_type: "manual",
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Trip created. Use Review next assignment to confirm an eligible driver.");
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
          <div className="flex items-center justify-between">
            <Label>Passenger</Label>
            <Button size="sm" variant="outline" onClick={() => setAddingPassenger(true)}>
              Add passenger
            </Button>
          </div>
          <Dialog open={addingPassenger} onOpenChange={setAddingPassenger}>
            <PassengerFormDialog
              onClose={() => setAddingPassenger(false)}
              onCreated={(id) => {
                setPassengerId(id);
                setSearch("");
              }}
            />
          </Dialog>
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
                No matching passengers.
              </div>
            )}
          </div>
        </div>

        <p className="rounded-lg bg-muted p-3 text-sm">
          Save the pickup first, then review an eligible driver with fresh GPS and no scheduling
          conflict.
        </p>

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
          <Label>Scheduled pickup · {Intl.DateTimeFormat().resolvedOptions().timeZone}</Label>
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
  onDeleted,
}: {
  trip: Trip;
  passengerName: string;
  driverName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [photoUrls, setPhotoUrls] = useState<{ start?: string; end?: string }>({});
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { user } = useAuth();

  async function handleDelete() {
    setDeleting(true);
    try {
      // Cascade: remove legacy billing rows tied to this trip.
      await supabase.from("trip_billing_records").delete().eq("trip_id", trip.id);

      // If a medicaid billing_records row is somehow linked to this trip.id,
      // log the cancellation before it cascades away with the trip.
      const { data: br } = await supabase
        .from("billing_records")
        .select("id")
        .eq("trip_id", trip.id)
        .maybeSingle();
      if (br?.id) {
        await supabase.from("billing_audit_log").insert({
          billing_record_id: br.id,
          action: "trip_cancelled",
          actor_id: user?.id ?? null,
          actor_type: "admin",
          notes: `Admin cancelled trip ${trip.id} (pickup ${trip.pickup_address})`,
        });
      }

      // Also clear any driver-facing ride_request pointing at this trip.
      await supabase.from("ride_requests").delete().eq("trip_id", trip.id);

      const { error } = await supabase.from("trips").delete().eq("id", trip.id);
      if (error) throw error;
      toast.success("Trip cancelled and deleted");
      setConfirmOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Failed to delete trip"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleOpenPdf() {
    setPdfLoading(true);
    try {
      let reportTripIds = [trip.id];
      if (trip.round_trip_group_id) {
        const { data: groupedTrips, error: groupError } = await supabase
          .from("trips")
          .select("id, round_trip_leg")
          .eq("round_trip_group_id", trip.round_trip_group_id)
          .order("round_trip_leg", { ascending: true });
        if (groupError) throw groupError;
        reportTripIds = (groupedTrips ?? []).map((groupedTrip) => groupedTrip.id);
      }
      const { data: reports, error: reportError } = await supabase
        .from("medicaid_trips")
        .select("state_pdf_path")
        .in("dispatch_trip_id", reportTripIds)
        .order("created_at", { ascending: false })
        .limit(1);
      if (reportError) throw reportError;
      const pdfPath = reports?.[0]?.state_pdf_path;
      if (!pdfPath) {
        throw new Error(
          "No saved PDF is available. Open Edit HCPF and choose Save & regenerate PDF.",
        );
      }
      const { data: signed, error: signError } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(pdfPath, 60 * 15);
      if (signError) throw signError;
      if (!signed?.signedUrl) throw new Error("The PDF download link could not be created");
      setPdfUrl(signed.signedUrl);
      toast.success("HCPF PDF opened");
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Could not open HCPF PDF"));
    } finally {
      setPdfLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
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
      if (!cancelled) setPhotoUrls(urls);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [trip.odometer_end_photo, trip.odometer_start_photo]);

  return (
    <>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-10">
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
                <div className="mb-1 text-xs font-medium text-muted-foreground">Odometer start</div>
                <img
                  src={photoUrls.start}
                  alt="Start odometer"
                  className="w-full rounded-xl border border-border"
                />
              </div>
            )}
            {photoUrls.end && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Odometer end</div>
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
        <DialogFooter className="mt-2 gap-2 border-t border-border/60 pt-4 sm:justify-between">
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
            className="whitespace-nowrap rounded-full"
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Cancel &amp; delete trip
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <TripReportEditor tripId={trip.id} />
            <Button
              variant="outline"
              onClick={handleOpenPdf}
              disabled={pdfLoading || trip.status !== "completed"}
              className="whitespace-nowrap rounded-full"
            >
              {pdfLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              View HCPF PDF
            </Button>
            <a
              href={`/track/${trip.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center whitespace-nowrap rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Open passenger tracking
            </a>
            <Button
              variant="secondary"
              onClick={onClose}
              className="whitespace-nowrap rounded-full"
            >
              Close
            </Button>
          </div>
        </DialogFooter>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this trip?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the trip
                {trip.driver_id
                  ? " and removes it from the assigned driver's app in real time"
                  : ""}
                . Any linked billing record will be cascaded and the cancellation logged to the
                audit trail. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Keep trip</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Yes, cancel trip
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
      <PdfPreviewDialog
        url={pdfUrl}
        filename={`hcpf-trip-${trip.id.slice(0, 8)}.pdf`}
        onClose={() => setPdfUrl(null)}
      />
    </>
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
