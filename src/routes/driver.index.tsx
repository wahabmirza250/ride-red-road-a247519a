import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  MapPin, Navigation, Power, Car, CheckCircle2, Phone, UserPlus, Search,
  Loader2, PenLine, XCircle, Plus, Fuel, FileCheck, Camera,
} from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useLocationBroadcast, requestCurrentPosition } from "@/lib/useGeolocation";
import { openNavigation as openMapsNav } from "@/lib/mapsDeepLink";
import { fmtMoney, haversineKm } from "@/lib/rideMath";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SignaturePad } from "@/components/driver/SignaturePad";
import { StatsGrid } from "@/components/driver/StatsGrid";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { driverCreatePassenger, driverSearchPassengers } from "@/lib/passenger.functions";
import { acceptRideOffer, declineRideOffer } from "@/lib/dispatch.functions";
import { clockIn, clockOut, getShiftStats, addShiftMiles } from "@/lib/shifts.functions";
import { recordTripMedia } from "@/lib/tripMedia.functions";
import { addTripStop, markStopArrived, markStopDeparted, updateTripAddress } from "@/lib/tripStops.functions";
import { ActiveRouteCard } from "@/components/driver/ActiveRouteCard";
import {
  detectOdometerFromImage,
  finalizeMedicaidFromDispatchTrip,
  ensureDispatchTripStatePdf,
  getTripReportDraft,
  saveTripReportDraft,
} from "@/lib/nemtTrip.functions";
import { VerifyMedicaidButton } from "@/components/VerifyMedicaidButton";

export const Route = createFileRoute("/driver/")({ component: DriverHome });

type DriverRow = {
  id: string;
  status: "available" | "busy" | "offline";
  current_lat: number | null;
  current_lng: number | null;
};
type Request = {
  id: string;
  passenger_id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number | null;
  estimated_fare: number | null;
  estimated_minutes: number | null;
  status: string;
  trip_id: string | null;
  driver_id: string | null;
  ride_purpose?: string | null;
};
type PaxRow = { id: string; first_name: string; last_name: string; phone: string | null; medicaid_id: string | null };
type Stop = {
  id: string; sequence: number; kind: string; address: string;
  arrived_at: string | null; departed_at: string | null; passenger_name: string | null;
};
type TripReportDraftForm = {
  identity_verified: "yes" | "no" | "";
  vehicle_type: "ground_ambulance" | "wheelchair_van" | "stretcher_van" | "taxi" | "ambulatory" | "";
  trip_kind: "one_way" | "round_trip" | "group_tour";
  escort_name: string;
  vehicle_plate: string;
  vehicle_vin: string;
  leg_date: string;
  pickup_time: string;
  pickup_address: string;
  pickup_odometer: string;
  dropoff_time: string;
  dropoff_address: string;
  dropoff_odometer: string;
  signed_by_escort: boolean;
};

const PURPOSE_LABEL: Record<string, string> = {
  doctor: "Doctor appointment", dialysis: "Dialysis", physical_therapy: "Physical therapy",
  pharmacy: "Pharmacy", mental_health: "Mental health", other: "Other",
};

function DriverHome() {
  const acceptFn = useServerFn(acceptRideOffer);
  const declineFn = useServerFn(declineRideOffer);
  const clockInFn = useServerFn(clockIn);
  const clockOutFn = useServerFn(clockOut);
  const statsFn = useServerFn(getShiftStats);
  const addMilesFn = useServerFn(addShiftMiles);
  const recordMediaFn = useServerFn(recordTripMedia);
  const addStopFn = useServerFn(addTripStop);
  const arrivedFn = useServerFn(markStopArrived);
  const departedFn = useServerFn(markStopDeparted);
  const finalizeFn = useServerFn(finalizeMedicaidFromDispatchTrip);
  const ensurePdfFn = useServerFn(ensureDispatchTripStatePdf);
  const saveDraftFn = useServerFn(saveTripReportDraft);

  const { user } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [pending, setPending] = useState<Request[]>([]);
  const [active, setActive] = useState<Request | null>(null);
  const [tripStatus, setTripStatus] = useState<string>("");
  const [passenger, setPassenger] = useState<PaxRow | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);

  const [showSign, setShowSign] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [showPickupForm, setShowPickupForm] = useState(false);
  const [showDropoffForm, setShowDropoffForm] = useState(false);
  const [pickupOdoDone, setPickupOdoDone] = useState(false);
  const [dropoffOdoDone, setDropoffOdoDone] = useState(false);
  const [pickupOdoReading, setPickupOdoReading] = useState<number | null>(null);
  const [dropoffOdoReading, setDropoffOdoReading] = useState<number | null>(null);

  // Live speed + odometer accumulation (client-side GPS-derived miles).
  const [speedMph, setSpeedMph] = useState<number | null>(null);
  const lastFixRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const milesBufferRef = useRef(0);

  // Shift stats
  const [stats, setStats] = useState({
    today_hours: 0, today_miles: 0, today_earnings: 0, hourly_rate: 0,
  });
  const refreshStats = useCallback(async () => {
    try {
      const r = await statsFn();
      setStats(r);
    } catch { /* ignore */ }
  }, [statsFn]);

  useEffect(() => {
    if (!user) return;
    supabase.from("drivers").select("id,status,current_lat,current_lng")
      .eq("user_id", user.id).maybeSingle()
      .then(({ data }) => data && setDriver(data as DriverRow));
    void refreshStats();
    const t = window.setInterval(refreshStats, 30000);
    return () => window.clearInterval(t);
  }, [user, refreshStats]);

  const online = driver ? driver.status !== "offline" : false;
  const [geoError, setGeoError] = useState<string | null>(null);

  const pushLoc = useCallback(async (p: { lat: number; lng: number }) => {
    if (!driver) return;
    setGeoError(null);
    // Accumulate GPS miles for the current shift.
    const now = Date.now();
    const last = lastFixRef.current;
    if (last) {
      const km = haversineKm({ lat: last.lat, lng: last.lng }, p);
      const dtSec = Math.max(1, (now - last.t) / 1000);
      const mph = (km * 0.621371) / (dtSec / 3600);
      if (isFinite(mph) && mph < 120) setSpeedMph(mph);
      // Filter GPS jitter: only count segments longer than 15 m
      if (km * 1000 > 15) {
        milesBufferRef.current += km * 0.621371;
        if (milesBufferRef.current > 0.25) {
          const delta = milesBufferRef.current;
          milesBufferRef.current = 0;
          addMilesFn({ data: { delta_miles: delta } }).catch(() => {});
          void refreshStats();
        }
      }
    }
    lastFixRef.current = { lat: p.lat, lng: p.lng, t: now };
    await supabase
      .from("drivers")
      .update({
        current_lat: p.lat,
        current_lng: p.lng,
        last_location_at: new Date().toISOString(),
      })
      .eq("id", driver.id);
  }, [driver, addMilesFn, refreshStats]);
  const handleGeoError = useCallback((msg: string) => setGeoError(msg), []);
  useLocationBroadcast(online, pushLoc, 10000, handleGeoError);

  const loadRequests = useCallback(async () => {
    if (!driver) return;
    const nowIso = new Date().toISOString();
    // Show: (a) any pending offer explicitly assigned to me — regardless of
    // TTL, so a stale-but-still-pending offer stays visible until it's
    // formally expired/re-dispatched — plus (b) unassigned pending requests
    // whose offer window hasn't lapsed.
    const { data: pend } = await supabase
      .from("ride_requests").select("*").eq("status", "pending")
      .or(
        `driver_id.eq.${driver.id},and(driver_id.is.null,or(offer_expires_at.is.null,offer_expires_at.gt.${nowIso}))`,
      )
      .order("created_at", { ascending: false }).limit(5);
    setPending((pend ?? []) as Request[]);

    const { data: act } = await supabase
      .from("ride_requests").select("*")
      .eq("driver_id", driver.id).eq("status", "accepted")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    let activeTripId: string | null = act?.trip_id ?? null;
    let synthetic: Request | null = (act ?? null) as Request | null;

    if (!synthetic) {
      const { data: t } = await supabase
        .from("trips").select("id,passenger_id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,estimated_fare,status,ride_purpose")
        .eq("driver_id", driver.id)
        .in("status", ["assigned", "driver_en_route_to_pickup", "arrived_at_pickup", "in_progress"])
        .order("scheduled_pickup_time", { ascending: true }).limit(1).maybeSingle();
      if (t) {
        activeTripId = t.id;
        synthetic = {
          id: `trip-${t.id}`, passenger_id: t.passenger_id,
          pickup_address: t.pickup_address, pickup_lat: Number(t.pickup_lat ?? 0), pickup_lng: Number(t.pickup_lng ?? 0),
          dropoff_address: t.dropoff_address, dropoff_lat: Number(t.dropoff_lat ?? 0), dropoff_lng: Number(t.dropoff_lng ?? 0),
          distance_km: null, estimated_fare: t.estimated_fare, estimated_minutes: null,
          status: "accepted", trip_id: t.id, driver_id: driver.id, ride_purpose: t.ride_purpose,
        };
      }
    }

    setActive(synthetic);

    if (activeTripId) {
      const { data: t } = await supabase.from("trips")
        .select("status, passenger_id, odometer_start_photo, odometer_end_photo, odometer_start, odometer_end")
        .eq("id", activeTripId).maybeSingle();
      setTripStatus(t?.status ?? "");
      setPickupOdoDone(!!t?.odometer_start_photo || t?.odometer_start != null);
      setDropoffOdoDone(!!t?.odometer_end_photo || t?.odometer_end != null);
      setPickupOdoReading(t?.odometer_start != null ? Number(t.odometer_start) : null);
      setDropoffOdoReading(t?.odometer_end != null ? Number(t.odometer_end) : null);
      if (t?.passenger_id) {
        const { data: p } = await supabase.from("passengers")
          .select("id, first_name, last_name, phone, medicaid_id").eq("id", t.passenger_id).maybeSingle();
        setPassenger((p as PaxRow) ?? null);
      }
      const { data: sr } = await supabase.from("trip_stops")
        .select("id, sequence, kind, address, arrived_at, departed_at, passenger_name")
        .eq("trip_id", activeTripId).order("sequence");
      setStops((sr as Stop[]) ?? []);
    } else {
      setTripStatus(""); setPassenger(null); setStops([]);
      setPickupOdoDone(false); setDropoffOdoDone(false);
      setPickupOdoReading(null); setDropoffOdoReading(null);
    }
  }, [driver]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  useEffect(() => {
    if (!driver) return;
    const ch = supabase.channel(`driver-${driver.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () => loadRequests())
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => loadRequests())
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_stops" }, () => loadRequests())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [driver, loadRequests]);

  async function toggleOnline() {
    if (!driver) return;
    const next = !online;
    if (next) {
      let pos: { lat: number; lng: number };
      try { pos = await requestCurrentPosition(); }
      catch (e) {
        const msg = e instanceof Error ? e.message : "Could not get location";
        setGeoError(msg); toast.error(msg); return;
      }
      const { error } = await supabase.from("drivers")
        .update({
          status: "available",
          current_lat: pos.lat,
          current_lng: pos.lng,
          last_location_at: new Date().toISOString(),
        })
        .eq("id", driver.id);
      if (error) return toast.error(error.message);
      setDriver({ ...driver, status: "available", current_lat: pos.lat, current_lng: pos.lng });
      setGeoError(null);
      try { await clockInFn({ data: {} }); toast.success("You're online — clocked in"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not clock in"); }
      void refreshStats();
    } else {
      const { error } = await supabase.from("drivers")
        .update({
          status: "offline",
          current_lat: null,
          current_lng: null,
          last_location_at: null,
        })
        .eq("id", driver.id);
      if (error) return toast.error(error.message);
      setDriver({ ...driver, status: "offline", current_lat: null, current_lng: null });
      setGeoError(null); setSpeedMph(null); lastFixRef.current = null;
      try { await clockOutFn({ data: {} }); toast.success("Clocked out"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not clock out"); }
      void refreshStats();
    }
  }

  async function accept(req: Request) {
    if (!driver) return;
    try {
      await acceptFn({ data: { request_id: req.id } });
      setDriver({ ...driver, status: "busy" });
      toast.success("Trip accepted");
      void loadRequests();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to accept"); }
  }

  async function setStatus(next: "driver_en_route_to_pickup" | "arrived_at_pickup" | "in_progress" | "completed") {
    if (!active?.trip_id) return;
    const patch: { status: typeof next; actual_pickup_time?: string; actual_dropoff_time?: string } = { status: next };
    if (next === "in_progress") patch.actual_pickup_time = new Date().toISOString();
    if (next === "completed") patch.actual_dropoff_time = new Date().toISOString();
    const { error } = await supabase.from("trips").update(patch).eq("id", active.trip_id);
    if (error) return toast.error(error.message);
    if (next === "completed") {
      await supabase.from("ride_requests").update({ status: "cancelled" })
        .eq("id", active.id).neq("status", "cancelled");
      if (driver) await supabase.from("drivers").update({ status: "available" }).eq("id", driver.id);
      toast.success("Trip completed — proof report available in trip history");
    }
    void loadRequests();
  }

  /**
   * Capture passenger signature and immediately mark the trip completed.
   * Signature is now part of the final trip-completion step — no separate
   * mid-trip screen — so the driver signs off with the rider exactly once.
   */
  async function saveSignatureAndComplete() {
    if (!active?.trip_id || !driver || !user) return;
    if (!signature) return toast.error("Please have the passenger sign");
    if (!signerName.trim()) return toast.error("Enter signer name");
    if (!dropoffOdoDone || dropoffOdoReading == null) {
      return toast.error("Save the drop-off odometer reading first");
    }
    if (pickupOdoReading == null) {
      return toast.error("Pickup odometer reading is missing");
    }
    setSaving(true);
    try {
      const blob = await (await fetch(signature)).blob();
      const sigPath = `${user.id}/${active.trip_id}-${Date.now()}.png`;
      const up = await supabase.storage.from("signatures").upload(sigPath, blob, {
        contentType: "image/png", upsert: false,
      });
      if (up.error) throw up.error;
      const now = new Date().toISOString();
      const { error } = await supabase.from("trips").update({
        signature_url: sigPath, signed_at: now, signer_name: signerName.trim(),
        patient_confirmed: true, patient_confirmed_at: now,
      }).eq("id", active.trip_id);
      if (error) throw error;

      // Mark completed BEFORE PDF gen so the trip is closed even if PDF errors.
      const tripIdSnapshot = active.trip_id;
      const signerSnapshot = signerName.trim();
      setShowSign(false); setSignature(null); setSignerName("");
      await setStatus("completed");

      // Server-side PDF generation: finalize the medicaid_trips row from
      // trip data (addresses, times, driver, vehicle, miles all auto-derived),
      // then render + upload the HCPF PDF on the server so we don't rely on
      // the browser being able to fetch the template asset.
      try {
        await finalizeFn({
          data: {
            trip_id: tripIdSnapshot,
            odometer_start: pickupOdoReading,
            odometer_end: dropoffOdoReading,
            signature_path: sigPath,
            signer_name: signerSnapshot,
            signed_by_escort: false,
          },
        });
        await ensurePdfFn({ data: { trip_id: tripIdSnapshot } });
        toast.success("Trip report PDF generated and saved");
      } catch (pdfErr) {
        toast.error(
          `Trip completed, but PDF generation failed: ${
            pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
          }`,
        );
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save signature"); }
    finally { setSaving(false); }
  }

  async function cancelActiveTrip() {
    if (!active?.trip_id || !driver) return;
    if (!window.confirm("Cancel this ride?")) return;
    setCancelling(true);
    try {
      await supabase.from("trips").update({ status: "cancelled" })
        .eq("id", active.trip_id).eq("driver_id", driver.id);
      if (!active.id.startsWith("trip-")) {
        await supabase.from("ride_requests").update({ status: "cancelled" })
          .eq("id", active.id).eq("driver_id", driver.id);
      }
      await supabase.from("drivers").update({ status: online ? "available" : "offline" }).eq("id", driver.id);
      toast.success("Ride cancelled");
      setActive(null); setTripStatus(""); setPassenger(null);
      void loadRequests();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to cancel ride"); }
    finally { setCancelling(false); }
  }

  async function switchPassenger(pax: PaxRow) {
    if (!active?.trip_id) return;
    const { error } = await supabase.from("trips").update({ passenger_id: pax.id }).eq("id", active.trip_id);
    if (error) return toast.error(error.message);
    setPassenger(pax); setShowPicker(false);
    toast.success(`Switched to ${pax.first_name} ${pax.last_name}`);
  }

  function openNavigation() {
    if (!active) return;
    const goingToDropoff = tripStatus === "in_progress";
    openMapsNav({
      lat: goingToDropoff ? active.dropoff_lat : active.pickup_lat,
      lng: goingToDropoff ? active.dropoff_lng : active.pickup_lng,
      address: goingToDropoff ? active.dropoff_address : active.pickup_address,
    });
  }

  async function uploadOdometer(file: File | null, which: "start" | "end", reading?: number | null) {
    if (!active?.trip_id || !user) return;
    let path: string | null = null;
    if (file) {
      path = `${user.id}/${active.trip_id}/odo_${which}_${Date.now()}.jpg`;
      const up = await supabase.storage.from("odometers").upload(path, file, {
        contentType: file.type || "image/jpeg", upsert: false,
      });
      if (up.error) throw new Error(up.error.message);
    }
    const patch =
      which === "start"
        ? { ...(path ? { odometer_start_photo: path } : {}), ...(reading != null ? { odometer_start: reading } : {}) }
        : { ...(path ? { odometer_end_photo: path } : {}), ...(reading != null ? { odometer_end: reading } : {}) };
    const { error } = await supabase.from("trips").update(patch).eq("id", active.trip_id);
    if (error) throw new Error(error.message);
    if (which === "start") {
      setPickupOdoDone(true);
      if (reading != null) setPickupOdoReading(reading);
    } else {
      setDropoffOdoDone(true);
      if (reading != null) setDropoffOdoReading(reading);
    }
    toast.success(file ? "Odometer photo and reading saved" : "Odometer reading saved");
  }

  /** Full HCPF trip report draft — saves all official fields, optional photos, and can start the trip. */
  async function savePickupForm(form: TripReportDraftForm, pickupFile: File | null, dropoffFile: File | null) {
    try {
      if (!active?.trip_id) return;
      const pickupReading = Number(form.pickup_odometer);
      if (!Number.isFinite(pickupReading) || pickupReading <= 0) {
        toast.error("Enter a valid pickup odometer reading");
        return;
      }
      await uploadOdometer(pickupFile, "start", pickupReading);
      if (form.dropoff_odometer) {
        const dropoffReading = Number(form.dropoff_odometer);
        if (Number.isFinite(dropoffReading) && dropoffReading > 0) {
          await uploadOdometer(dropoffFile, "end", dropoffReading);
        }
      }
      await saveDraftFn({ data: { trip_id: active.trip_id, form_data: form } });
      if (tripStatus === "assigned" || tripStatus === "driver_en_route_to_pickup") {
        setShowPickupForm(false);
        toast.success("Trip report saved");
        return;
      }
      await setStatus("in_progress");
      setShowPickupForm(false);
      toast.success("Trip started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save form");
    }
  }

  /** Final HCPF trip report save — captures dropoff fields, then opens signature. */
  async function saveDropoffForm(form: TripReportDraftForm, pickupFile: File | null, dropoffFile: File | null) {
    try {
      if (!active?.trip_id) return;
      const pickupReading = Number(form.pickup_odometer);
      const dropoffReading = Number(form.dropoff_odometer);
      if (!Number.isFinite(pickupReading) || pickupReading <= 0) {
        toast.error("Enter a valid pickup odometer reading");
        return;
      }
      if (!Number.isFinite(dropoffReading) || dropoffReading <= 0) {
        toast.error("Enter a valid drop-off odometer reading");
        return;
      }
      if (!pickupOdoDone || pickupFile) await uploadOdometer(pickupFile, "start", pickupReading);
      await uploadOdometer(dropoffFile, "end", dropoffReading);
      await saveDraftFn({ data: { trip_id: active.trip_id, form_data: form } });
      setShowDropoffForm(false);
      // Immediately open signature dialog so completion is one continuous flow.
      setSignerName(passenger ? `${passenger.first_name} ${passenger.last_name}` : "");
      setSignature(null);
      setShowSign(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save drop-off form");
    }
  }









  async function addStop(address: string, coords: { lat: number; lng: number } | null) {
    if (!active?.trip_id) return;
    try {
      await addStopFn({ data: { trip_id: active.trip_id, address, lat: coords?.lat ?? null, lng: coords?.lng ?? null, added_by: "driver" } });
      setShowAddStop(false);
      toast.success("Stop added to trip");
      void loadRequests();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to add stop"); }
  }

  if (!driver) {
    return <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">Setting up your driver profile…</div>;
  }

  const showOffers = !active && online;

  return (
    <div className="space-y-4">
      {/* Header: status + earnings dashboard */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div>
          <div className="text-sm text-muted-foreground">Status</div>
          <div className="text-lg font-semibold">
            {online ? "Online — clocked in" : "Offline — clocked out"}
          </div>
        </div>
        <Button onClick={toggleOnline}
          className={`h-14 w-14 rounded-full ${online ? "bg-emerald-500 hover:bg-emerald-600" : ""}`}>
          <Power className="h-6 w-6" />
        </Button>
      </div>

      <StatsGrid
        todayHours={stats.today_hours} todayMiles={stats.today_miles}
        todayEarnings={stats.today_earnings} hourlyRate={stats.hourly_rate}
        speedMph={online ? speedMph : null} onShift={online}
      />

      <div className="grid grid-cols-3 gap-2">
        <Link to="/driver/expenses"
          className="flex items-center justify-center gap-1 rounded-full border border-border bg-surface py-2 text-xs">
          <Fuel className="h-3.5 w-3.5" /> Gas
        </Link>
        <Link to="/driver/earnings"
          className="flex items-center justify-center gap-1 rounded-full border border-border bg-surface py-2 text-xs">
          Earnings
        </Link>
        <Link to="/driver/history"
          className="flex items-center justify-center gap-1 rounded-full border border-border bg-surface py-2 text-xs">
          History
        </Link>
      </div>

      {geoError && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-medium">Location problem</div>
          <div>{geoError}</div>
          <div className="mt-1 text-xs opacity-80">Dispatch can't send you rides until your location updates.</div>
        </div>
      )}
      {/* Assigned multi-passenger route stop list */}
      <ActiveRouteCard />

      {/* Active trip */}

      {active && (
        <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-widest text-primary">
              Active trip · {(tripStatus || "accepted").replace(/_/g, " ")}
            </div>
            <Badge>{fmtMoney(active.estimated_fare)}</Badge>
          </div>

          {active.ride_purpose && (
            <div className="rounded-lg bg-surface px-3 py-2 text-xs">
              <span className="text-muted-foreground">Purpose: </span>
              <span className="font-medium">{PURPOSE_LABEL[active.ride_purpose] ?? active.ride_purpose}</span>
            </div>
          )}

          <div className="rounded-xl bg-surface px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Passenger</div>
                <div className="font-medium">{passenger ? `${passenger.first_name} ${passenger.last_name}` : "Unknown"}</div>
                {passenger?.phone && <div className="text-xs text-muted-foreground">{passenger.phone}</div>}
                {passenger?.medicaid_id && (
                  <div className="text-[11px] text-muted-foreground">HFC ID: {passenger.medicaid_id}</div>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowPicker(true)}>Change</Button>
            </div>
            {passenger?.id && (
              <div className="mt-2 border-t border-border/60 pt-2">
                <VerifyMedicaidButton passengerId={passenger.id} />
              </div>
            )}
          </div>


          <div className="space-y-2">
            <div className="flex gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <div className="text-xs text-muted-foreground">Pickup</div>
                <div>{active.pickup_address}</div>
              </div>
            </div>
            {stops.length > 0 && (
              <div className="space-y-1 border-l-2 border-dashed border-primary/40 pl-3">
                {stops.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <div>
                      <span className="mr-1 rounded bg-primary/10 px-1 py-0.5 text-[10px] uppercase text-primary">{s.kind}</span>
                      {s.passenger_name ? `${s.passenger_name} · ` : ""}{s.address}
                    </div>
                    <div className="flex gap-1">
                      {!s.arrived_at && (
                        <button className="text-primary underline"
                          onClick={() => arrivedFn({ data: { stop_id: s.id } }).then(() => loadRequests())}>Arrived</button>
                      )}
                      {s.arrived_at && !s.departed_at && (
                        <button className="text-primary underline"
                          onClick={() => departedFn({ data: { stop_id: s.id } }).then(() => loadRequests())}>Depart</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <div className="text-xs text-muted-foreground">Dropoff</div>
                <div>{active.dropoff_address}</div>
              </div>
            </div>
          </div>

          {/* Drop-off odometer is captured inside the Complete-trip dialog
              (mirrors the pickup Fill-Form step) so the driver captures the
              photo + reading in the same flow as the signature. */}

          {/* Step-by-step primary action. Only ONE main button per step. */}
          <div className="space-y-2 pt-2">
            {tripStatus === "assigned" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="h-12 w-full rounded-full bg-primary text-base"
                  onClick={() => { setStatus("driver_en_route_to_pickup"); openNavigation(); }}
                >
                  <Navigation className="mr-2 h-5 w-5" /> Navigate
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-full text-base"
                  onClick={() => setShowPickupForm(true)}
                >
                  <FileCheck className="mr-2 h-5 w-5" /> Fill form
                </Button>
              </div>
            )}
            {tripStatus === "driver_en_route_to_pickup" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="h-12 w-full rounded-full bg-primary text-base"
                  onClick={() => setStatus("arrived_at_pickup")}
                >
                  <Car className="mr-2 h-5 w-5" /> Arrive at Pickup
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-full text-base"
                  onClick={() => setShowPickupForm(true)}
                >
                  <FileCheck className="mr-2 h-5 w-5" /> Fill form
                </Button>
              </div>
            )}
            {tripStatus === "arrived_at_pickup" && (
              <Button
                className="h-12 w-full rounded-full bg-primary text-base"
                onClick={() => setShowPickupForm(true)}
              >
                <FileCheck className="mr-2 h-5 w-5" /> Fill form &amp; start trip
              </Button>
            )}
            {tripStatus === "in_progress" && (
              <Button
                className="h-12 w-full rounded-full bg-emerald-500 text-base hover:bg-emerald-600"
                onClick={() => setShowDropoffForm(true)}
              >
                <PenLine className="mr-2 h-5 w-5" /> Complete &amp; get signature
              </Button>
            )}

            {/* Secondary actions — always small, out of the main flow. */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap gap-2">
                {tripStatus && tripStatus !== "assigned" && (
                  <Button size="sm" variant="ghost" className="rounded-full text-xs" onClick={openNavigation}>
                    <Navigation className="mr-1 h-3.5 w-3.5" /> Navigate
                  </Button>
                )}
                {tripStatus !== "in_progress" ? null : null}
                <Button size="sm" variant="ghost" className="rounded-full text-xs" onClick={() => setShowAddStop(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add stop
                </Button>
                {active.trip_id && tripStatus === "in_progress" && (
                  <Link
                    to="/trips/$tripId/proof"
                    params={{ tripId: active.trip_id }}
                    className="inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <FileCheck className="mr-1 h-3.5 w-3.5" /> Proof
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={cancelActiveTrip}
                disabled={cancelling}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50"
              >
                {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                Cancel ride
              </button>
            </div>
          </div>
        </div>
      )}

      {showOffers && (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Incoming requests</div>
          {pending.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Waiting for ride requests…
            </div>
          )}
          {pending.map((r) => {
            const etaMin = etaMinutesFor(driver, r);
            return (
              <div key={r.id} className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-soft">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {r.distance_km ? `${r.distance_km.toFixed(1)} km · ` : ""}
                    {etaMin != null ? `~${etaMin} min to pickup` : "pickup ETA unknown"}
                  </div>
                  <div className="text-lg font-bold">{fmtMoney(r.estimated_fare)}</div>
                </div>
                {r.ride_purpose && (
                  <div className="text-xs text-muted-foreground">
                    Purpose: <span className="font-medium text-foreground">{PURPOSE_LABEL[r.ride_purpose] ?? r.ride_purpose}</span>
                  </div>
                )}
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="truncate">↑ {r.pickup_address}</div>
                  <div className="truncate">↓ {r.dropoff_address}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="rounded-full"
                    onClick={() => declineFn({ data: { request_id: r.id } }).then(() => loadRequests())}>Decline</Button>
                  <Button className="rounded-full" onClick={() => accept(r)}>Accept</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!online && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Tap the power button to go online (clocks you in) and start receiving trips.
        </div>
      )}

      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
        <Phone className="h-4 w-4" /> Allow location permissions for live tracking to work.
      </div>

      {/* Signature dialog — final trip completion step: signature is captured
          inline as part of finishing the trip, not as a separate mid-ride screen. */}
      <Dialog open={showSign} onOpenChange={setShowSign}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Complete trip &amp; capture signature</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="signer">Signer name</Label>
              <Input id="signer" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
            </div>
            <SignaturePad onChange={setSignature} />
            <div className="text-[11px] text-muted-foreground">
              Timestamp will be recorded automatically at save time. Saving marks the trip completed.
            </div>
            <Button className="w-full rounded-full" onClick={saveSignatureAndComplete} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save signature & complete trip"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add-stop dialog */}
      <AddStopDialog open={showAddStop} onOpenChange={setShowAddStop} onAdd={addStop} />

      {/* Pickup odometer capture — manual number entry + optional photo/OCR. */}
      <PickupFormDialog
        open={showPickupForm}
        onOpenChange={setShowPickupForm}
        tripId={active?.trip_id ?? null}
        readingField="pickup"
        onSubmit={savePickupForm}
        alreadyCaptured={pickupOdoDone}
        initialReading={pickupOdoReading}
        title="Pickup odometer"
        submitLabel="Save & start trip"
      />

      {/* Drop-off odometer form — captures final reading + optional photo before signature. */}
      <PickupFormDialog
        open={showDropoffForm}
        onOpenChange={setShowDropoffForm}
        tripId={active?.trip_id ?? null}
        readingField="dropoff"
        onSubmit={saveDropoffForm}
        alreadyCaptured={dropoffOdoDone}
        initialReading={dropoffOdoReading}
        title="Drop-off odometer"
        submitLabel="Save & capture signature"
      />

      {/* Passenger picker */}
      <PassengerPickerDialog open={showPicker} onOpenChange={setShowPicker} onPick={switchPassenger} />
    </div>
  );
}

function etaMinutesFor(driver: DriverRow | null, r: Request): number | null {
  if (!driver?.current_lat || !driver?.current_lng) return r.estimated_minutes ?? null;
  const km = haversineKm(
    { lat: driver.current_lat, lng: driver.current_lng },
    { lat: r.pickup_lat, lng: r.pickup_lng },
  );
  const mins = Math.max(1, Math.round((km / 40) * 60));
  return mins;
}

function AddStopDialog({
  open, onOpenChange, onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (address: string, coords: { lat: number; lng: number } | null) => void;
}) {
  const [addr, setAddr] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => { if (!open) { setAddr(""); setCoords(null); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add a mid-ride stop</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <AddressAutocomplete
            value={addr}
            onChange={(v) => { setAddr(v); setCoords(null); }}
            onResolve={(p) => { setAddr(p.address); setCoords({ lat: p.lat, lng: p.lng }); }}
            placeholder="Pharmacy, ATM, etc."
          />
          <Button className="w-full rounded-full" onClick={() => addr && onAdd(addr, coords)} disabled={!addr}>
            Add stop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PassengerPickerDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (p: PaxRow) => void;
}) {
  const search = useServerFn(driverSearchPassengers);
  const createPax = useServerFn(driverCreatePassenger);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PaxRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"search" | "new">("search");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [medicaid, setMedicaid] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ(""); setResults([]); setMode("search");
      setFirstName(""); setLastName(""); setPhone(""); setMedicaid("");
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim() || mode !== "search") return;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await search({ data: { q } });
        setResults(r as PaxRow[]);
      } catch (e) { toast.error(e instanceof Error ? e.message : "Search failed"); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode, search]);

  async function handleCreate() {
    if (!firstName.trim() || !lastName.trim()) return toast.error("Enter first and last name");
    setCreating(true);
    try {
      const p = await createPax({ data: { first_name: firstName, last_name: lastName, phone, medicaid_id: medicaid } });
      onPick(p as PaxRow);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to add passenger"); }
    finally { setCreating(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Passenger</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "search" ? "default" : "outline"} onClick={() => setMode("search")} className="flex-1 rounded-full">
            <Search className="mr-1 h-4 w-4" /> Search
          </Button>
          <Button size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")} className="flex-1 rounded-full">
            <UserPlus className="mr-1 h-4 w-4" /> Add new
          </Button>
        </div>
        {mode === "search" ? (
          <div className="space-y-3">
            <Input placeholder="Phone, Medicaid ID, or name" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {searching && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />}
              {!searching && results.length === 0 && q && (
                <div className="text-center text-xs text-muted-foreground">No matches. Try "Add new".</div>
              )}
              {results.map((p) => (
                <button key={p.id} onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left hover:bg-accent">
                  <div>
                    <div className="font-medium">{p.first_name} {p.last_name}</div>
                    <div className="text-xs text-muted-foreground">{p.phone ?? "no phone"} · {p.medicaid_id ?? ""}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Medicaid ID (optional)</Label><Input value={medicaid} onChange={(e) => setMedicaid(e.target.value)} /></div>
            <Button className="w-full rounded-full" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add & use"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickupFormDialog({
  open, onOpenChange, tripId, onSubmit, alreadyCaptured,
  initialReading, readingField,
  title = "Trip report — start pickup",
  submitLabel = "Save & start trip",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tripId: string | null;
  readingField: "pickup" | "dropoff";
  onSubmit: (form: TripReportDraftForm, pickupFile: File | null, dropoffFile: File | null) => Promise<void>;
  alreadyCaptured: boolean;
  initialReading?: number | null;
  title?: string;
  submitLabel?: string;
}) {
  const emptyForm: TripReportDraftForm = {
    identity_verified: "",
    vehicle_type: "",
    trip_kind: "one_way",
    escort_name: "",
    vehicle_plate: "",
    vehicle_vin: "",
    leg_date: "",
    pickup_time: "",
    pickup_address: "",
    pickup_odometer: "",
    dropoff_time: "",
    dropoff_address: "",
    dropoff_odometer: "",
    signed_by_escort: false,
  };
  const [form, setForm] = useState<TripReportDraftForm>(emptyForm);
  const [pickupFile, setPickupFile] = useState<File | null>(null);
  const [dropoffFile, setDropoffFile] = useState<File | null>(null);
  const [pickupPreview, setPickupPreview] = useState<string | null>(null);
  const [dropoffPreview, setDropoffPreview] = useState<string | null>(null);
  const [passengerSummary, setPassengerSummary] = useState<{ name: string; medicaidId: string | null }>({ name: "", medicaidId: null });
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [scanningField, setScanningField] = useState<"pickup" | "dropoff" | null>(null);
  const pickupCameraRef = useRef<HTMLInputElement | null>(null);
  const dropoffCameraRef = useRef<HTMLInputElement | null>(null);
  const detectOdo = useServerFn(detectOdometerFromImage);
  const loadDraft = useServerFn(getTripReportDraft);

  useEffect(() => {
    if (!open) {
      setPickupFile(null); setDropoffFile(null); setPickupPreview(null); setDropoffPreview(null);
      setForm(emptyForm); setBusy(false); setLoadingDraft(false); setScanningField(null);
      return;
    }
    if (!tripId) return;
    let cancelled = false;
    setLoadingDraft(true);
    loadDraft({ data: { trip_id: tripId } })
      .then((r) => {
        if (cancelled) return;
        const loaded = normalizeTripReportForm(r.form_data ?? emptyForm, emptyForm);
        setForm({
          ...loaded,
          pickup_odometer: readingField === "pickup" && initialReading != null ? String(initialReading) : loaded.pickup_odometer ?? "",
          dropoff_odometer: readingField === "dropoff" && initialReading != null ? String(initialReading) : loaded.dropoff_odometer ?? "",
        });
        setPassengerSummary({ name: r.passenger_name ?? "", medicaidId: r.medicaid_id ?? null });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load trip report"))
      .finally(() => { if (!cancelled) setLoadingDraft(false); });
    return () => { cancelled = true; };
  }, [open, tripId, initialReading, readingField, loadDraft]);

  function setField<K extends keyof TripReportDraftForm>(key: K, value: TripReportDraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.readAsDataURL(f);
    });
  }

  async function handleCameraCapture(kind: "pickup" | "dropoff", f: File | null) {
    if (!f) return;
    if (kind === "pickup") {
      setPickupFile(f);
      setPickupPreview(URL.createObjectURL(f));
    } else {
      setDropoffFile(f);
      setDropoffPreview(URL.createObjectURL(f));
    }
    setScanningField(kind);
    try {
      const dataUrl = await fileToDataUrl(f);
      const res = await detectOdo({ data: { image_data_url: dataUrl } });
      if (res?.odometer) {
        if (kind === "pickup") {
          setField("pickup_odometer", res.odometer);
        } else {
          setField("dropoff_odometer", res.odometer);
        }
        toast.success(`Detected odometer: ${res.odometer}`);
      } else {
        toast.message("Couldn't read the odometer — enter it manually.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Auto-detect failed";
      toast.error(msg);
    } finally {
      setScanningField(null);
    }
  }

  async function handleSubmit() {
    const n = Number(form.pickup_odometer);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a valid pickup odometer reading");
    setBusy(true);
    try {
      await onSubmit(form, pickupFile, dropoffFile);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {loadingDraft && <div className="text-xs text-muted-foreground">Loading saved report…</div>}
          {(passengerSummary.name || passengerSummary.medicaidId) && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <div className="font-medium text-foreground">{passengerSummary.name || "Passenger"}</div>
              <div className="text-muted-foreground">Member ID: {passengerSummary.medicaidId || "—"}</div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Driver verified identity</Label>
              <Select value={form.identity_verified || "blank"} onValueChange={(v) => setField("identity_verified", v === "blank" ? "" : v as "yes" | "no")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Leave blank</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type of vehicle</Label>
              <Select value={form.vehicle_type || "blank"} onValueChange={(v) => setField("vehicle_type", v === "blank" ? "" : v as TripReportDraftForm["vehicle_type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Leave blank</SelectItem>
                  <SelectItem value="ground_ambulance">Ground ambulance</SelectItem>
                  <SelectItem value="wheelchair_van">Wheelchair van</SelectItem>
                  <SelectItem value="stretcher_van">Stretcher van</SelectItem>
                  <SelectItem value="taxi">Taxi</SelectItem>
                  <SelectItem value="ambulatory">Mobility / ambulatory</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type of trip</Label>
              <Select value={form.trip_kind} onValueChange={(v) => setField("trip_kind", v as TripReportDraftForm["trip_kind"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_way">One way</SelectItem>
                  <SelectItem value="round_trip">Round trip</SelectItem>
                  <SelectItem value="group_tour">Group tour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Vehicle plate" value={form.vehicle_plate} onChange={(v) => setField("vehicle_plate", v)} />
            <TextField label="Vehicle VIN" value={form.vehicle_vin} onChange={(v) => setField("vehicle_vin", v)} />
            <TextField label="Trip date" type="date" value={form.leg_date} onChange={(v) => setField("leg_date", v)} />
            <TextField label="Escort name" value={form.escort_name} onChange={(v) => setField("escort_name", v)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <OdometerField
              label="Pickup odometer"
              value={form.pickup_odometer}
              onChange={(v) => setField("pickup_odometer", v)}
              onCamera={() => pickupCameraRef.current?.click()}
              scanning={scanningField === "pickup"}
              hasFile={!!pickupFile}
            />
            <OdometerField
              label="Drop-off odometer"
              value={form.dropoff_odometer}
              onChange={(v) => setField("dropoff_odometer", v)}
              onCamera={() => dropoffCameraRef.current?.click()}
              scanning={scanningField === "dropoff"}
              hasFile={!!dropoffFile}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Pickup time" type="time" value={form.pickup_time} onChange={(v) => setField("pickup_time", v)} />
            <TextField label="Drop-off time" type="time" value={form.dropoff_time} onChange={(v) => setField("dropoff_time", v)} />
          </div>
          <TextField label="Pickup address" value={form.pickup_address} onChange={(v) => setField("pickup_address", v)} />
          <TextField label="Drop-off address" value={form.dropoff_address} onChange={(v) => setField("dropoff_address", v)} />

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.signed_by_escort} onCheckedChange={(v) => setField("signed_by_escort", v === true)} />
            Member facility or escort signs instead of member
          </label>

          <input ref={pickupCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void handleCameraCapture("pickup", f); }} />
          <input ref={dropoffCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void handleCameraCapture("dropoff", f); }} />
          {(pickupPreview || dropoffPreview) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {pickupPreview && <img src={pickupPreview} alt="Pickup odometer preview" className="max-h-36 w-full rounded-lg border border-border object-contain" />}
              {dropoffPreview && <img src={dropoffPreview} alt="Drop-off odometer preview" className="max-h-36 w-full rounded-lg border border-border object-contain" />}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            All fields are editable before the PDF is generated. Camera capture is optional; manual odometer entry works without a photo.
          </div>
          <Button className="w-full rounded-full" onClick={handleSubmit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function normalizeTripReportForm(value: unknown, fallback: TripReportDraftForm): TripReportDraftForm {
  const data = typeof value === "object" && value !== null ? value as Partial<Record<keyof TripReportDraftForm, unknown>> : {};
  const text = (key: keyof TripReportDraftForm) => typeof data[key] === "string" ? data[key] : fallback[key];
  const identity = data.identity_verified === "yes" || data.identity_verified === "no" ? data.identity_verified : "";
  const vehicleTypes = new Set(["ground_ambulance", "wheelchair_van", "stretcher_van", "taxi", "ambulatory", ""]);
  const vehicleType = typeof data.vehicle_type === "string" && vehicleTypes.has(data.vehicle_type) ? data.vehicle_type : "";
  const tripKinds = new Set(["one_way", "round_trip", "group_tour"]);
  const tripKind = typeof data.trip_kind === "string" && tripKinds.has(data.trip_kind) ? data.trip_kind : fallback.trip_kind;
  return {
    identity_verified: identity,
    vehicle_type: vehicleType as TripReportDraftForm["vehicle_type"],
    trip_kind: tripKind as TripReportDraftForm["trip_kind"],
    escort_name: text("escort_name") as string,
    vehicle_plate: text("vehicle_plate") as string,
    vehicle_vin: text("vehicle_vin") as string,
    leg_date: text("leg_date") as string,
    pickup_time: text("pickup_time") as string,
    pickup_address: text("pickup_address") as string,
    pickup_odometer: text("pickup_odometer") as string,
    dropoff_time: text("dropoff_time") as string,
    dropoff_address: text("dropoff_address") as string,
    dropoff_odometer: text("dropoff_odometer") as string,
    signed_by_escort: data.signed_by_escort === true,
  };
}

function OdometerField({
  label, value, onChange, onCamera, scanning, hasFile,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCamera: () => void;
  scanning: boolean;
  hasFile: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-stretch gap-2">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder={scanning ? "Auto-reading…" : "e.g. 84521"}
          className="flex-1"
        />
        <Button type="button" variant="secondary" className="shrink-0 gap-1.5" onClick={onCamera} aria-label={`Capture ${label} with camera`}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          <span className="hidden sm:inline text-xs">{hasFile ? "Retake" : "Camera"}</span>
        </Button>
      </div>
    </div>
  );
}
