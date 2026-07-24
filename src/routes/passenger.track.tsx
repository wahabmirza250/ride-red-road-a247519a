import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MapPin, Clock, Phone, ChevronLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { lookupPassengerRides } from "@/lib/passenger.functions";
import { fmtMoney } from "@/lib/rideMath";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/passenger/track")({
  ssr: false,
  component: TrackExisting,
});

type Trip = {
  id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_time: string;
  estimated_fare: number | null;
  driver: { name: string; phone: string | null; vehicle: string | null } | null;
};

/**
 * "My rides" — signed-in-only.
 *
 * PRIVACY: The previous version accepted phone / Medicaid ID from ANY visitor
 * and looked rides up with a service-role fuzzy phone match, which leaked
 * other passengers' trip details. It also auto-ran that lookup from values
 * cached in `localStorage`, so a fresh visitor on a shared device could see
 * whichever passenger had used the page last. This screen now requires sign
 * in and shows only trips owned by the authenticated passenger.
 */
function TrackExisting() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const lookup = useServerFn(lookupPassengerRides);
  const [busy, setBusy] = useState(false);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await lookup({ data: {} });
      setTrips(res.trips as Trip[]);
      setName(res.passengers[0]?.name ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your rides");
    } finally {
      setBusy(false);
    }
  }, [lookup]);

  useEffect(() => {
    if (loading || !user) return;
    void load();
  }, [loading, user, load]);

  // One-time cleanup: remove any lingering identity values a previous version
  // of this page persisted to `localStorage`, so a shared device can't
  // resurface them by any code path.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem("passenger_phone");
    window.localStorage.removeItem("passenger_medicaid");
  }, []);

  if (!loading && !user) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Link to="/passenger" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-surface/80 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">My rides</h1>
        </div>
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-6 text-sm shadow-soft">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-widest">Sign in required</span>
          </div>
          <p className="text-muted-foreground">
            For your privacy, ride history is only visible to the signed-in passenger it belongs to.
          </p>
          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            onClick={() => void navigate({ to: "/passenger/signup" })}
          >
            Sign in to view my rides
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/passenger" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-surface/80 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">My rides</h1>
      </div>

      {name && (
        <div className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{name}</span>
        </div>
      )}

      {busy && (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your rides…
        </div>
      )}

      {!busy && trips !== null && trips.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No rides on file yet.
        </div>
      )}

      <div className="space-y-3">
        {(trips ?? []).map((t) => (
          <div key={t.id} className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="capitalize">{t.status.replace(/_/g, " ")}</Badge>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />{new Date(t.scheduled_pickup_time).toLocaleString()}
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>{t.pickup_address}</span></div>
              <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><span>{t.dropoff_address}</span></div>
            </div>
            {t.driver && (
              <div className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{t.driver.name}</div>
                  {t.driver.vehicle && <div className="text-xs text-muted-foreground">{t.driver.vehicle}</div>}
                </div>
                {t.driver.phone && (
                  <a href={`tel:${t.driver.phone}`} className="rounded-full bg-primary p-2 text-primary-foreground transition hover:brightness-110">
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
            {t.estimated_fare != null && <div className="text-right text-sm font-medium">{fmtMoney(t.estimated_fare)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
