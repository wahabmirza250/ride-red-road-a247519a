import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  MapPin,
  Navigation,
  Power,
  Car,
  CheckCircle2,
  Phone,
  UserPlus,
  Search,
  Loader2,
  PenLine,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useLocationBroadcast } from "@/lib/useGeolocation";
import { openNavigation as openMapsNav } from "@/lib/mapsDeepLink";
import { fmtMoney } from "@/lib/rideMath";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/driver/SignaturePad";
import {
  driverCreatePassenger,
  driverSearchPassengers,
} from "@/lib/passenger.functions";

export const Route = createFileRoute("/driver/")({
  component: DriverHome,
});

type DriverRow = {
  id: string;
  is_online: boolean;
  status: string;
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
};

type PaxRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  medicaid_id: string | null;
};

function DriverHome() {
  const { user } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [pending, setPending] = useState<Request[]>([]);
  const [active, setActive] = useState<Request | null>(null);
  const [tripStatus, setTripStatus] = useState<string>("");
  const [passenger, setPassenger] = useState<PaxRow | null>(null);

  const [showSign, setShowSign] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("drivers")
      .select("id,is_online,status,current_lat,current_lng")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => data && setDriver(data as DriverRow));
  }, [user]);

  const online = driver?.is_online ?? false;

  const pushLoc = useCallback(
    async (p: { lat: number; lng: number }) => {
      if (!driver) return;
      await supabase.from("drivers").update({ current_lat: p.lat, current_lng: p.lng }).eq("id", driver.id);
    },
    [driver],
  );
  useLocationBroadcast(online, pushLoc, 5000);

  const loadRequests = useCallback(async () => {
    if (!driver) return;
    const { data: pend } = await supabase
      .from("ride_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);
    setPending((pend ?? []) as Request[]);

    // Active from ride_requests (driver-accepted flow)
    const { data: act } = await supabase
      .from("ride_requests")
      .select("*")
      .eq("driver_id", driver.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let activeTripId: string | null = act?.trip_id ?? null;
    let synthetic: Request | null = (act ?? null) as Request | null;

    // Fallback: admin-assigned trip (no matching ride_request)
    if (!synthetic) {
      const { data: t } = await supabase
        .from("trips")
        .select(
          "id,passenger_id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,estimated_fare,status",
        )
        .eq("driver_id", driver.id)
        .in("status", ["assigned", "driver_en_route_to_pickup", "arrived_at_pickup", "in_progress"])
        .order("scheduled_pickup_time", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (t) {
        activeTripId = t.id;
        synthetic = {
          id: `trip-${t.id}`,
          passenger_id: t.passenger_id,
          pickup_address: t.pickup_address,
          pickup_lat: Number(t.pickup_lat ?? 0),
          pickup_lng: Number(t.pickup_lng ?? 0),
          dropoff_address: t.dropoff_address,
          dropoff_lat: Number(t.dropoff_lat ?? 0),
          dropoff_lng: Number(t.dropoff_lng ?? 0),
          distance_km: null,
          estimated_fare: t.estimated_fare,
          estimated_minutes: null,
          status: "accepted",
          trip_id: t.id,
          driver_id: driver.id,
        };
      }
    }

    setActive(synthetic);

    if (activeTripId) {
      const { data: t } = await supabase
        .from("trips")
        .select("status, passenger_id")
        .eq("id", activeTripId)
        .maybeSingle();
      setTripStatus(t?.status ?? "");
      if (t?.passenger_id) {
        const { data: p } = await supabase
          .from("passengers")
          .select("id, first_name, last_name, phone, medicaid_id")
          .eq("id", t.passenger_id)
          .maybeSingle();
        setPassenger((p as PaxRow) ?? null);
      }
    } else {
      setTripStatus("");
      setPassenger(null);
    }
  }, [driver]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!driver) return;
    const ch = supabase
      .channel(`driver-${driver.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () => loadRequests())
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => loadRequests())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [driver, loadRequests]);

  async function toggleOnline() {
    if (!driver) return;
    const next = !online;
    const { error } = await supabase
      .from("drivers")
      .update({ is_online: next, status: next ? "available" : "offline" })
      .eq("id", driver.id);
    if (error) return toast.error(error.message);
    setDriver({ ...driver, is_online: next, status: next ? "available" : "offline" });
    toast.success(next ? "You're online" : "Went offline");
  }

  async function accept(req: Request) {
    if (!driver) return;
    const { data: trip, error: tErr } = await supabase
      .from("trips")
      .insert({
        driver_id: driver.id,
        passenger_id: req.passenger_id,
        status: "assigned",
        pickup_address: req.pickup_address,
        pickup_lat: req.pickup_lat,
        pickup_lng: req.pickup_lng,
        dropoff_address: req.dropoff_address,
        dropoff_lat: req.dropoff_lat,
        dropoff_lng: req.dropoff_lng,
        estimated_fare: req.estimated_fare,
        scheduled_pickup_time: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (tErr || !trip) return toast.error(tErr?.message ?? "Failed to accept");
    const { error } = await supabase
      .from("ride_requests")
      .update({ status: "accepted", driver_id: driver.id, trip_id: trip.id })
      .eq("id", req.id)
      .eq("status", "pending");
    if (error) return toast.error(error.message);
    await supabase.from("drivers").update({ status: "on_trip" }).eq("id", driver.id);
    toast.success("Trip accepted");
    void loadRequests();
  }

  async function setStatus(
    next: "driver_en_route_to_pickup" | "arrived_at_pickup" | "in_progress" | "completed",
  ) {
    if (!active?.trip_id) return;
    const patch: {
      status: typeof next;
      actual_pickup_time?: string;
      actual_dropoff_time?: string;
    } = { status: next };
    if (next === "in_progress") patch.actual_pickup_time = new Date().toISOString();
    if (next === "completed") patch.actual_dropoff_time = new Date().toISOString();
    const { error } = await supabase.from("trips").update(patch).eq("id", active.trip_id);
    if (error) return toast.error(error.message);
    if (next === "driver_en_route_to_pickup") toast.success("Dispatcher notified — pickup started");
    if (next === "arrived_at_pickup") toast.success("Marked arrived at pickup");
    if (next === "completed") {
      await supabase
        .from("ride_requests")
        .update({ status: "cancelled" })
        .eq("id", active.id)
        .neq("status", "cancelled");
      if (driver) await supabase.from("drivers").update({ status: "available" }).eq("id", driver.id);
      toast.success("Trip completed — collect fare");
    }
    void loadRequests();
  }

  async function saveSignatureAndStart() {
    if (!active?.trip_id || !driver || !user) return;
    if (!signature) return toast.error("Please have the passenger sign");
    if (!signerName.trim()) return toast.error("Enter signer name");
    setSaving(true);
    try {
      const blob = await (await fetch(signature)).blob();
      const path = `${user.id}/${active.trip_id}-${Date.now()}.png`;
      const up = await supabase.storage.from("signatures").upload(path, blob, {
        contentType: "image/png",
        upsert: false,
      });
      if (up.error) throw up.error;
      const { error } = await supabase
        .from("trips")
        .update({
          signature_url: path,
          signed_at: new Date().toISOString(),
          signer_name: signerName.trim(),
          patient_confirmed: true,
          patient_confirmed_at: new Date().toISOString(),
        })
        .eq("id", active.trip_id);
      if (error) throw error;
      setShowSign(false);
      setSignature(null);
      setSignerName("");
      await setStatus("in_progress");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save signature");
    } finally {
      setSaving(false);
    }
  }

  async function cancelActiveTrip() {
    if (!active?.trip_id || !driver) return;
    if (!window.confirm("Cancel this ride?")) return;
    setCancelling(true);
    try {
      const { error: tripError } = await supabase
        .from("trips")
        .update({ status: "cancelled" })
        .eq("id", active.trip_id)
        .eq("driver_id", driver.id);
      if (tripError) throw tripError;

      if (!active.id.startsWith("trip-")) {
        const { error: requestError } = await supabase
          .from("ride_requests")
          .update({ status: "cancelled" })
          .eq("id", active.id)
          .eq("driver_id", driver.id);
        if (requestError) throw requestError;
      }

      const { error: driverError } = await supabase
        .from("drivers")
        .update({ status: online ? "available" : "offline" })
        .eq("id", driver.id);
      if (driverError) throw driverError;

      toast.success("Ride cancelled");
      setActive(null);
      setTripStatus("");
      setPassenger(null);
      void loadRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel ride");
    } finally {
      setCancelling(false);
    }
  }

  async function switchPassenger(pax: PaxRow) {
    if (!active?.trip_id) return;
    const { error } = await supabase
      .from("trips")
      .update({ passenger_id: pax.id })
      .eq("id", active.trip_id);
    if (error) return toast.error(error.message);
    setPassenger(pax);
    setShowPicker(false);
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

  if (!driver) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
        Setting up your driver profile…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Online toggle */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div>
          <div className="text-sm text-muted-foreground">Status</div>
          <div className="text-lg font-semibold">
            {online ? "Online — receiving trips" : "Offline"}
          </div>
        </div>
        <Button
          onClick={toggleOnline}
          className={`h-14 w-14 rounded-full ${online ? "bg-emerald-500 hover:bg-emerald-600" : ""}`}
        >
          <Power className="h-6 w-6" />
        </Button>
      </div>

      {/* NEMT quick action */}
      <Link
        to="/driver/trip/new"
        className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-soft transition hover:border-primary hover:bg-primary/10"
      >
        <div>
          <div className="text-sm font-semibold">Complete NEMT trip</div>
          <div className="text-xs text-muted-foreground">
            Fill the state Trip Report digitally · round-trip &amp; group tours
          </div>
        </div>
        <PenLine className="h-5 w-5 text-primary" />
      </Link>

      {/* Active trip */}
      {active && (
        <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-widest text-primary">
              Active trip · {(tripStatus || "accepted").replace(/_/g, " ")}
            </div>
            <Badge>{fmtMoney(active.estimated_fare)}</Badge>
          </div>

          {/* Passenger */}
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2">
            <div>
              <div className="text-xs text-muted-foreground">Passenger</div>
              <div className="font-medium">
                {passenger ? `${passenger.first_name} ${passenger.last_name}` : "Unknown"}
              </div>
              {passenger?.phone && (
                <div className="text-xs text-muted-foreground">{passenger.phone}</div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowPicker(true)}>
              Change
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <div className="text-xs text-muted-foreground">Pickup</div>
                <div>{active.pickup_address}</div>
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <div className="text-xs text-muted-foreground">Dropoff</div>
                <div>{active.dropoff_address}</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" className="rounded-full" onClick={openNavigation}>
              <Navigation className="mr-1 h-4 w-4" /> Navigate
            </Button>
            <Link
              to="/driver/trip/new"
              search={{ tripId: active.trip_id ?? undefined } as { tripId?: string }}
              className="inline-flex h-10 items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <PenLine className="mr-1 h-4 w-4" /> Trip report
            </Link>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={cancelActiveTrip}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
              Cancel
            </Button>
            {tripStatus === "assigned" && (
              <Button
                className="rounded-full bg-primary"
                onClick={() => {
                  setStatus("driver_en_route_to_pickup");
                  openNavigation();
                }}
              >
                <Navigation className="mr-1 h-4 w-4" /> Start Pickup
              </Button>
            )}
            {tripStatus === "driver_en_route_to_pickup" && (
              <Button className="rounded-full" onClick={() => setStatus("arrived_at_pickup")}>
                <Car className="mr-1 h-4 w-4" /> I've Arrived
              </Button>
            )}
            {tripStatus === "arrived_at_pickup" && (
              <Button
                className="rounded-full"
                onClick={() => {
                  setSignerName(passenger ? `${passenger.first_name} ${passenger.last_name}` : "");
                  setShowSign(true);
                }}
              >
                <PenLine className="mr-1 h-4 w-4" /> Get signature
              </Button>
            )}
            {tripStatus === "in_progress" && (
              <Button
                className="rounded-full bg-emerald-500 hover:bg-emerald-600"
                onClick={() => setStatus("completed")}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Complete
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Pending requests */}
      {!active && online && (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Incoming requests
          </div>
          {pending.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Waiting for ride requests…
            </div>
          )}
          {pending.map((r) => (
            <div key={r.id} className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  {r.distance_km ? `${r.distance_km.toFixed(1)} km` : ""} · {r.estimated_minutes ?? "?"} min
                </div>
                <div className="text-lg font-bold">{fmtMoney(r.estimated_fare)}</div>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="truncate">↑ {r.pickup_address}</div>
                <div className="truncate">↓ {r.dropoff_address}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={async () => {
                    await supabase.from("ride_requests").update({ status: "rejected" }).eq("id", r.id);
                    void loadRequests();
                  }}
                >
                  Skip
                </Button>
                <Button className="rounded-full" onClick={() => accept(r)}>
                  Accept
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!online && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Tap the power button to go online and start receiving trips.
        </div>
      )}
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
        <Phone className="h-4 w-4" /> Allow location permissions for live tracking to work.
      </div>

      {/* Signature dialog */}
      <Dialog open={showSign} onOpenChange={setShowSign}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Passenger signature</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="signer">Signer name</Label>
              <Input id="signer" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
            </div>
            <SignaturePad onChange={setSignature} />
            <Button className="w-full rounded-full" onClick={saveSignatureAndStart} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & start trip"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Passenger picker */}
      <PassengerPickerDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        onPick={switchPassenger}
      />
    </div>
  );
}

function PassengerPickerDialog({
  open,
  onOpenChange,
  onPick,
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
      setQ("");
      setResults([]);
      setMode("search");
      setFirstName("");
      setLastName("");
      setPhone("");
      setMedicaid("");
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim() || mode !== "search") return;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await search({ data: { q } });
        setResults(r as PaxRow[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Search failed");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode, search]);

  async function handleCreate() {
    if (!firstName.trim() || !lastName.trim()) return toast.error("Enter first and last name");
    setCreating(true);
    try {
      const p = await createPax({
        data: { first_name: firstName, last_name: lastName, phone, medicaid_id: medicaid },
      });
      onPick(p as PaxRow);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add passenger");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Passenger</DialogTitle>
        </DialogHeader>
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
                <button
                  key={p.id}
                  onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left hover:bg-accent"
                >
                  <div>
                    <div className="font-medium">
                      {p.first_name} {p.last_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.phone ?? "no phone"} · {p.medicaid_id ?? ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>First name</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Medicaid ID (optional)</Label>
              <Input value={medicaid} onChange={(e) => setMedicaid(e.target.value)} />
            </div>
            <Button className="w-full rounded-full" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add & use"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
