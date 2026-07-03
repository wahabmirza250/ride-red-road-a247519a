import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Search, MapPin, Clock, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { lookupPassengerRides } from "@/lib/passenger.functions";
import { fmtMoney } from "@/lib/rideMath";

export const Route = createFileRoute("/passenger/")({
  component: PassengerHome,
});

type Trip = {
  id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_time: string;
  actual_pickup_time: string | null;
  actual_dropoff_time: string | null;
  estimated_fare: number | null;
  driver: { name: string; phone: string | null; vehicle: string | null } | null;
};

function PassengerHome() {
  const lookup = useServerFn(lookupPassengerRides);
  const [phone, setPhone] = useState("");
  const [medicaid, setMedicaid] = useState("");
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [passengerName, setPassengerName] = useState<string>("");

  const run = useCallback(
    async (p: string, m: string) => {
      setLoading(true);
      try {
        const res = await lookup({ data: { phone: p, medicaidId: m } });
        setTrips(res.trips as Trip[]);
        setPassengerName(res.passengers[0]?.name ?? "");
        if (!res.passengers.length) toast.info("No account found — please give this info to your driver at pickup.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        setLoading(false);
      }
    },
    [lookup],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = window.localStorage.getItem("passenger_phone") ?? "";
    const m = window.localStorage.getItem("passenger_medicaid") ?? "";
    if (p || m) {
      setPhone(p);
      setMedicaid(m);
      void run(p, m);
    }
  }, [run]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone && !medicaid) return toast.error("Enter phone or Medicaid ID");
    if (typeof window !== "undefined") {
      window.localStorage.setItem("passenger_phone", phone);
      window.localStorage.setItem("passenger_medicaid", medicaid);
    }
    void run(phone, medicaid);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-soft">
        <h1 className="text-lg font-semibold tracking-tight">Find your ride</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          No sign-up needed. Enter your phone or Medicaid ID to see your ride status.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="text-center text-xs text-muted-foreground">— or —</div>
          <div className="space-y-1.5">
            <Label htmlFor="mid">Medicaid ID</Label>
            <Input id="mid" value={medicaid} onChange={(e) => setMedicaid(e.target.value)} />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="mr-2 h-4 w-4" /> Look up</>}
          </Button>
        </form>
      </div>

      {passengerName && (
        <div className="text-sm text-muted-foreground">
          Rides for <span className="font-medium text-foreground">{passengerName}</span>
        </div>
      )}

      {trips !== null && trips.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No rides on file yet.
        </div>
      )}

      <div className="space-y-3">
        {(trips ?? []).map((t) => (
          <div key={t.id} className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="capitalize">
                {t.status.replace(/_/g, " ")}
              </Badge>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(t.scheduled_pickup_time).toLocaleString()}
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>{t.pickup_address}</span>
              </div>
              <div className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <span>{t.dropoff_address}</span>
              </div>
            </div>
            {t.driver && (
              <div className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{t.driver.name}</div>
                  {t.driver.vehicle && (
                    <div className="text-xs text-muted-foreground">{t.driver.vehicle}</div>
                  )}
                </div>
                {t.driver.phone && (
                  <a href={`tel:${t.driver.phone}`} className="rounded-full bg-primary p-2 text-primary-foreground">
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
            {t.estimated_fare != null && (
              <div className="text-right text-sm font-medium">{fmtMoney(t.estimated_fare)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
