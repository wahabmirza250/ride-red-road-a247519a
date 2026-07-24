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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/driver/SignaturePad";
import { StatsGrid } from "@/components/driver/StatsGrid";
import { OdometerPhotoButton } from "@/components/driver/OdometerPhotoButton";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { driverCreatePassenger, driverSearchPassengers } from "@/lib/passenger.functions";
import { acceptRideOffer, declineRideOffer } from "@/lib/dispatch.functions";
import { clockIn, clockOut, getShiftStats, addShiftMiles } from "@/lib/shifts.functions";
import { recordTripMedia } from "@/lib/tripMedia.functions";
import { addTripStop, markStopArrived, markStopDeparted } from "@/lib/tripStops.functions";
import {
  detectOdometerFromImage,
  finalizeMedicaidFromDispatchTrip,
  attachStatePdf,
} from "@/lib/nemtTrip.functions";
import { generateStateFormPdf } from "@/lib/medicaidPdf";
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
  const [pickupOdoDone, setPickupOdoDone] = useState(false);
  const [dropoffOdoDone, setDropoffOdoDone] = useState(false);

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
    await supabase.from("drivers").update({ current_lat: p.lat, current_lng: p.lng }).eq("id", driver.id);
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
        .select("status, passenger_id, odometer_start_photo, odometer_end_photo")
        .eq("id", activeTripId).maybeSingle();
      setTripStatus(t?.status ?? "");
      setPickupOdoDone(!!t?.odometer_start_photo);
      setDropoffOdoDone(!!t?.odometer_end_photo);
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
        .update({ status: "available", current_lat: pos.lat, current_lng: pos.lng })
        .eq("id", driver.id);
      if (error) return toast.error(error.message);
      setDriver({ ...driver, status: "available", current_lat: pos.lat, current_lng: pos.lng });
      setGeoError(null);
      try { await clockInFn({ data: {} }); toast.success("You're online — clocked in"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not clock in"); }
      void refreshStats();
    } else {
      const { error } = await supabase.from("drivers")
        .update({ status: "offline", current_lat: null, current_lng: null }).eq("id", driver.id);
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
    if (!dropoffOdoDone) return toast.error("Capture the drop-off odometer photo first");
    setSaving(true);
    try {
      const blob = await (await fetch(signature)).blob();
      const path = `${user.id}/${active.trip_id}-${Date.now()}.png`;
      const up = await supabase.storage.from("signatures").upload(path, blob, {
        contentType: "image/png", upsert: false,
      });
      if (up.error) throw up.error;
      const now = new Date().toISOString();
      const { error } = await supabase.from("trips").update({
        signature_url: path, signed_at: now, signer_name: signerName.trim(),
        patient_confirmed: true, patient_confirmed_at: now,
      }).eq("id", active.trip_id);
      if (error) throw error;
      setShowSign(false); setSignature(null); setSignerName("");
      await setStatus("completed");
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

  async function uploadOdometer(file: File, which: "start" | "end", reading?: number | null) {
    if (!active?.trip_id || !user) return;
    const path = `${user.id}/${active.trip_id}/odo_${which}_${Date.now()}.jpg`;
    const up = await supabase.storage.from("odometers").upload(path, file, {
      contentType: file.type || "image/jpeg", upsert: false,
    });
    if (up.error) throw new Error(up.error.message);
    const patch =
      which === "start"
        ? { odometer_start_photo: path, ...(reading != null ? { odometer_start: reading } : {}) }
        : { odometer_end_photo: path, ...(reading != null ? { odometer_end: reading } : {}) };
    const { error } = await supabase.from("trips").update(patch).eq("id", active.trip_id);
    if (error) throw new Error(error.message);
    if (which === "start") setPickupOdoDone(true); else setDropoffOdoDone(true);
    toast.success("Odometer photo saved");
  }

  /** Trip report / pickup form — captures odometer reading + photo, then starts the trip. */
  async function savePickupForm(file: File, reading: number) {
    try {
      await uploadOdometer(file, "start", reading);
      await setStatus("in_progress");
      setShowPickupForm(false);
      toast.success("Trip started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save form");
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

          {/* Drop-off odometer photo is captured inline; pickup odometer is
              captured inside the Fill Form dialog (Step 4). */}
          {tripStatus === "in_progress" && (
            <div className="rounded-xl border border-dashed border-border bg-surface p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Required before completing
              </div>
              <OdometerPhotoButton
                label="Drop-off odometer photo"
                captured={dropoffOdoDone}
                onCaptured={(f) => uploadOdometer(f, "end")}
              />
              {!dropoffOdoDone && (
                <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  Capture the drop-off odometer before you can complete the trip.
                </div>
              )}
            </div>
          )}

          {/* Step-by-step primary action. Only ONE main button per step. */}
          <div className="space-y-2 pt-2">
            {tripStatus === "assigned" && (
              <Button
                className="h-12 w-full rounded-full bg-primary text-base"
                onClick={() => { setStatus("driver_en_route_to_pickup"); openNavigation(); }}
              >
                <Navigation className="mr-2 h-5 w-5" /> Navigate to Pickup
              </Button>
            )}
            {tripStatus === "driver_en_route_to_pickup" && (
              <Button
                className="h-12 w-full rounded-full bg-primary text-base"
                onClick={() => setStatus("arrived_at_pickup")}
              >
                <Car className="mr-2 h-5 w-5" /> Arrive at Pickup
              </Button>
            )}
            {tripStatus === "arrived_at_pickup" && (
              <Button
                className="h-12 w-full rounded-full bg-primary text-base"
                onClick={() => setShowPickupForm(true)}
              >
                <FileCheck className="mr-2 h-5 w-5" /> Fill Form
              </Button>
            )}
            {tripStatus === "in_progress" && (
              <Button
                className="h-12 w-full rounded-full bg-emerald-500 text-base hover:bg-emerald-600"
                disabled={!dropoffOdoDone}
                onClick={() => {
                  if (!dropoffOdoDone) {
                    toast.error("Capture the drop-off odometer photo first");
                    return;
                  }
                  setSignerName(passenger ? `${passenger.first_name} ${passenger.last_name}` : "");
                  setSignature(null);
                  setShowSign(true);
                }}
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

      {/* Trip report / pickup form — captures odometer reading + photo, then starts the trip. */}
      <PickupFormDialog
        open={showPickupForm}
        onOpenChange={setShowPickupForm}
        onSubmit={savePickupForm}
        alreadyCaptured={pickupOdoDone}
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
  open, onOpenChange, onSubmit, alreadyCaptured,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (file: File, reading: number) => Promise<void>;
  alreadyCaptured: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const detectOdo = useServerFn(detectOdometerFromImage);

  useEffect(() => {
    if (!open) {
      setFile(null); setPreview(null); setReading(""); setBusy(false); setScanning(false);
    }
  }, [open]);

  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.readAsDataURL(f);
    });
  }

  async function handleCameraCapture(f: File | null) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setScanning(true);
    try {
      const dataUrl = await fileToDataUrl(f);
      const res = await detectOdo({ data: { image_data_url: dataUrl } });
      if (res?.odometer) {
        setReading(res.odometer);
        toast.success(`Detected odometer: ${res.odometer}`);
      } else {
        toast.message("Couldn't read the odometer — enter it manually.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Auto-detect failed";
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  }

  async function handleSubmit() {
    const n = Number(reading);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a valid odometer reading");
    if (!file && !alreadyCaptured) return toast.error("Take the odometer photo");
    setBusy(true);
    try {
      if (file) await onSubmit(file, n);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Trip report — start pickup</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Tap the camera to snap the odometer — the number is read automatically.
            You can also type it manually. Saving starts the trip.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="odo">Odometer reading (miles)</Label>
            <div className="flex items-stretch gap-2">
              <Input
                id="odo"
                inputMode="decimal"
                value={reading}
                onChange={(e) => setReading(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={scanning ? "Reading photo…" : "e.g. 84521"}
                disabled={scanning}
                className="flex-1"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = ""; // allow re-selecting the same file
                  void handleCameraCapture(f);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 gap-1.5"
                onClick={() => cameraInputRef.current?.click()}
                disabled={scanning || busy}
                aria-label="Capture odometer with camera"
                title="Capture odometer with camera"
              >
                {scanning
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Camera className="h-4 w-4" />}
                <span className="hidden sm:inline text-xs">Camera</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {scanning
                ? "Detecting number from photo…"
                : file
                  ? "Photo captured. Double-check the number is correct."
                  : "Manual entry is fine too — photo required to start the trip."}
            </p>
          </div>
          {preview && (
            <img src={preview} alt="Odometer preview" className="max-h-40 w-full rounded-lg border border-border object-contain" />
          )}
          <div className="text-[11px] text-muted-foreground">
            Timestamp is recorded automatically at save.
          </div>
          <Button className="w-full rounded-full" onClick={handleSubmit} disabled={busy || scanning}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & start trip"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
