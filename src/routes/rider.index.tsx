import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MapPin, Star, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useCurrentPosition } from "@/lib/useGeolocation";
import { usePricing } from "@/lib/usePricing";
import { estimateFare, haversineKm, fmtMoney } from "@/lib/rideMath";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrackMap } from "@/components/nemt/useClientMap";

export const Route = createFileRoute("/rider/")({
  component: RiderBook,
});

type Place = { id: string; label: string; address: string; lat: number; lng: number; kind: string };
type Request = {
  id: string;
  status: string;
  driver_id: string | null;
  trip_id: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  estimated_fare: number | null;
  estimated_minutes: number | null;
};

/**
 * Cheap geocoder: if the user types "lat,lng" we use it directly.
 * Otherwise we fall back to their current location + a slight offset so the
 * MVP still works without a paid geocoding API. Admin can add proper
 * geocoding later.
 */
function parseLatLng(s: string): { lat: number; lng: number } | null {
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

function RiderBook() {
  const { user } = useAuth();
  const { pos: myPos } = useCurrentPosition();
  const pricing = usePricing();
  const [pickupTxt, setPickupTxt] = useState("");
  const [dropoffTxt, setDropoffTxt] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [active, setActive] = useState<Request | null>(null);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [driverName, setDriverName] = useState<string>("");
  const [tripStatus, setTripStatus] = useState<string>("");
  const [showRate, setShowRate] = useState<{ tripId: string; driverId: string } | null>(null);
  const [rating, setRating] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("saved_places")
      .select("*")
      .eq("user_id", user.id)
      .then(({ data }) => setPlaces((data ?? []) as Place[]));
  }, [user]);

  useEffect(() => {
    if (myPos && !pickupTxt) setPickupTxt(`${myPos.lat.toFixed(5)},${myPos.lng.toFixed(5)}`);
  }, [myPos, pickupTxt]);

  // Load current active request
  const loadActive = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ride_requests")
      .select("*")
      .eq("passenger_id", user.id)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setActive((data ?? null) as Request | null);
    if (data?.driver_id) {
      const { data: d } = await supabase
        .from("drivers")
        .select("current_lat,current_lng,user_id")
        .eq("id", data.driver_id)
        .maybeSingle();
      if (d) {
        setDriverLoc(
          d.current_lat != null && d.current_lng != null
            ? { lat: Number(d.current_lat), lng: Number(d.current_lng) }
            : null,
        );
        if (d.user_id) {
          const { data: p } = await supabase
            .from("profiles")
            .select("first_name,last_name")
            .eq("id", d.user_id)
            .maybeSingle();
          setDriverName([p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Your driver");
        }
      }
    } else {
      setDriverLoc(null);
      setDriverName("");
    }
    if (data?.trip_id) {
      const { data: t } = await supabase
        .from("trips")
        .select("status")
        .eq("id", data.trip_id)
        .maybeSingle();
      setTripStatus(t?.status ?? "");
      if (t?.status === "completed") {
        setShowRate({ tripId: data.trip_id, driverId: data.driver_id! });
        // Clear active — completed rides drop off the "active" list via status=cancelled by driver
      }
    }
  }, [user]);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`rider-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () =>
        loadActive(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => loadActive())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "drivers" }, (p) => {
        const row = p.new as { id?: string; current_lat?: number; current_lng?: number };
        if (active?.driver_id && row.id === active.driver_id && row.current_lat && row.current_lng) {
          setDriverLoc({ lat: Number(row.current_lat), lng: Number(row.current_lng) });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, active?.driver_id, loadActive]);

  const pickup = useMemo(() => parseLatLng(pickupTxt), [pickupTxt]);
  const dropoff = useMemo(() => parseLatLng(dropoffTxt), [dropoffTxt]);
  const estimate = useMemo(() => {
    if (!pickup || !dropoff) return null;
    const km = haversineKm(pickup, dropoff);
    const e = estimateFare(km, pricing);
    return { ...e, km };
  }, [pickup, dropoff, pricing]);

  async function request() {
    if (!user) return;
    if (!pickup || !dropoff) return toast.error("Enter both pickup and dropoff (lat,lng)");
    setSubmitting(true);
    const { error } = await supabase.from("ride_requests").insert({
      passenger_id: user.id,
      pickup_address: pickupTxt,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_address: dropoffTxt,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      distance_km: estimate?.km ?? null,
      estimated_fare: estimate?.fare ?? null,
      estimated_minutes: estimate?.minutes ?? null,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Ride requested — waiting for a driver");
    void loadActive();
  }

  async function cancel() {
    if (!active) return;
    await supabase.from("ride_requests").update({ status: "cancelled" }).eq("id", active.id);
    if (active.trip_id) {
      await supabase.from("trips").update({ status: "cancelled" }).eq("id", active.trip_id);
    }
    toast.success("Ride cancelled");
    void loadActive();
  }

  async function submitRating() {
    if (!showRate) return;
    await supabase
      .from("trips")
      .update({ passenger_rating: rating })
      .eq("id", showRate.tripId);
    setShowRate(null);
    toast.success("Thanks for the rating");
  }

  // ACTIVE RIDE UI
  if (active) {
    const center: [number, number] = driverLoc
      ? [driverLoc.lat, driverLoc.lng]
      : [active.pickup_lat, active.pickup_lng];
    return (
      <div className="space-y-3">
        <div className="h-72 overflow-hidden rounded-2xl border border-border">
          <TrackMap
            center={center}
            pickup={[active.pickup_lat, active.pickup_lng]}
            dropoff={[active.dropoff_lat, active.dropoff_lng]}
            driver={driverLoc ? [driverLoc.lat, driverLoc.lng] : null}
          />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {active.status === "pending"
              ? "Finding a driver…"
              : tripStatus === "in_progress"
                ? "On your way"
                : tripStatus === "arrived_at_pickup"
                  ? "Driver has arrived"
                  : "Driver on the way"}
          </div>
          <div className="mt-1 text-lg font-semibold">
            {driverName || (active.status === "pending" ? "Waiting for driver…" : "Your driver")}
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex gap-2">
              <MapPin className="mt-0.5 h-4 w-4 text-emerald-500" />
              <span className="truncate">{active.pickup_address}</span>
            </div>
            <div className="flex gap-2">
              <MapPin className="mt-0.5 h-4 w-4 text-red-500" />
              <span className="truncate">{active.dropoff_address}</span>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted-foreground">Fare </span>
              <span className="font-semibold">{fmtMoney(active.estimated_fare)}</span>
            </div>
            <Button variant="outline" className="rounded-full" onClick={cancel}>
              <XCircle className="mr-1 h-4 w-4" /> Cancel
            </Button>
          </div>
        </div>

        {showRate && (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-sm font-semibold">Rate your driver</div>
            <div className="mt-3 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)}>
                  <Star
                    className={`h-8 w-8 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                  />
                </button>
              ))}
            </div>
            <Button className="mt-4 w-full rounded-full" onClick={submitRating}>
              Submit
            </Button>
          </div>
        )}
      </div>
    );
  }

  // BOOK UI
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-lg font-semibold">Where to?</h2>
        <p className="text-xs text-muted-foreground">
          Enter coordinates as <code>lat,lng</code>. Address search coming soon.
        </p>
        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pickup">Pickup</Label>
            <Input
              id="pickup"
              placeholder="e.g. 39.7392,-104.9903"
              value={pickupTxt}
              onChange={(e) => setPickupTxt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dropoff">Dropoff</Label>
            <Input
              id="dropoff"
              placeholder="e.g. 39.7500,-104.9800"
              value={dropoffTxt}
              onChange={(e) => setDropoffTxt(e.target.value)}
            />
          </div>
        </div>
        {places.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {places.map((p) => (
              <button
                key={p.id}
                onClick={() => setDropoffTxt(`${p.lat},${p.lng}`)}
                className="rounded-full border border-border bg-accent px-3 py-1 text-xs"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {estimate && (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-accent px-4 py-3 text-sm">
            <div>
              <span className="text-muted-foreground">Distance </span>
              <span className="font-semibold">{estimate.km.toFixed(1)} km</span>
            </div>
            <div>
              <span className="text-muted-foreground">ETA </span>
              <span className="font-semibold">{estimate.minutes} min</span>
            </div>
            <div className="text-lg font-bold">{fmtMoney(estimate.fare)}</div>
          </div>
        )}
        <Button
          onClick={request}
          disabled={submitting || !estimate}
          className="mt-4 w-full rounded-full"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request ride"}
        </Button>
      </div>
      <div className="text-center text-xs text-muted-foreground">
        <Link to="/rider/places" className="underline">
          Add saved places
        </Link>{" "}
        for one-tap booking.
      </div>
    </div>
  );
}
