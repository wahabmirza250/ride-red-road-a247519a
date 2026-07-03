import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MapPin, Navigation, Power, Car, CheckCircle2, Phone } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useLocationBroadcast } from "@/lib/useGeolocation";
import { fmtMoney } from "@/lib/rideMath";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

function DriverHome() {
  const { user } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [pending, setPending] = useState<Request[]>([]);
  const [active, setActive] = useState<Request | null>(null);
  const [tripStatus, setTripStatus] = useState<string>("");

  // Load driver row
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

  // Broadcast GPS while online, update drivers.current_lat/lng
  const pushLoc = useCallback(
    async (p: { lat: number; lng: number }) => {
      if (!driver) return;
      await supabase
        .from("drivers")
        .update({ current_lat: p.lat, current_lng: p.lng })
        .eq("id", driver.id);
    },
    [driver],
  );
  useLocationBroadcast(online, pushLoc, 5000);

  // Load pending + assigned requests
  const loadRequests = useCallback(async () => {
    if (!driver) return;
    const { data: pend } = await supabase
      .from("ride_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);
    setPending((pend ?? []) as Request[]);
    const { data: act } = await supabase
      .from("ride_requests")
      .select("*")
      .eq("driver_id", driver.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setActive((act ?? null) as Request | null);
    if (act?.trip_id) {
      const { data: t } = await supabase
        .from("trips")
        .select("status")
        .eq("id", act.trip_id)
        .maybeSingle();
      setTripStatus(t?.status ?? "");
    } else {
      setTripStatus("");
    }
  }, [driver]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  // Realtime updates
  useEffect(() => {
    if (!driver) return;
    const ch = supabase
      .channel(`driver-${driver.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () =>
        loadRequests(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () =>
        loadRequests(),
      )
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
    // Create a trip row
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

  async function setStatus(next: "arrived_at_pickup" | "in_progress" | "completed") {
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

  const navUrl = useMemo(() => {
    if (!active) return "";
    const dest =
      tripStatus === "in_progress"
        ? `${active.dropoff_lat},${active.dropoff_lng}`
        : `${active.pickup_lat},${active.pickup_lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  }, [active, tripStatus]);

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

      {/* Active trip */}
      {active && (
        <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-widest text-primary">
              Active trip · {tripStatus || "accepted"}
            </div>
            <Badge>{fmtMoney(active.estimated_fare)}</Badge>
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
            <Button asChild variant="outline" className="rounded-full">
              <a href={navUrl} target="_blank" rel="noreferrer">
                <Navigation className="mr-1 h-4 w-4" /> Navigate
              </a>
            </Button>
            {tripStatus === "assigned" && (
              <Button className="rounded-full" onClick={() => setStatus("arrived_at_pickup")}>
                <Car className="mr-1 h-4 w-4" /> Arrived
              </Button>
            )}
            {tripStatus === "arrived_at_pickup" && (
              <Button className="rounded-full" onClick={() => setStatus("in_progress")}>
                Start trip
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
                  {r.distance_km ? `${r.distance_km.toFixed(1)} km` : ""} ·{" "}
                  {r.estimated_minutes ?? "?"} min
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
                    await supabase
                      .from("ride_requests")
                      .update({ status: "rejected" })
                      .eq("id", r.id);
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
    </div>
  );
}
