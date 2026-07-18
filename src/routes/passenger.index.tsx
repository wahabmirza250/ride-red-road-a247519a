import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Search, MapPin, Clock, Phone, Car, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { lookupPassengerRides } from "@/lib/passenger.functions";
import { fmtMoney } from "@/lib/rideMath";
import { HeroMap } from "@/components/passenger/HeroMap";
import { BrandMark } from "@/components/Brand";
import { cn } from "@/lib/utils";

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

  const hasResults = trips !== null;

  return (
    <div className="space-y-5">
      {/* Hero: living map + branded lookup card */}
      <section
        className={cn(
          "relative overflow-hidden rounded-[28px] border border-border/60 bg-surface shadow-lift",
          "transition-all duration-500",
          hasResults ? "min-h-[220px]" : "min-h-[520px]",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-500",
            hasResults ? "opacity-40" : "opacity-100",
          )}
        >
          <HeroMap />
        </div>

        <div className="relative flex h-full flex-col p-5 sm:p-6">
          <div className="flex items-center gap-3 animate-rise-in">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/85 backdrop-blur-md shadow-soft ring-1 ring-border/50">
              <BrandMark className="h-8 w-8" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                RedArt Rides
              </div>
              <div className="text-sm text-muted-foreground">
                Your ride, ready when you are.
              </div>
            </div>
          </div>

          {!hasResults && (
            <div className="mt-6 flex-1 animate-rise-in [animation-delay:80ms]">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                Find your ride
              </h1>
              <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                No sign-up needed. Enter your phone or Medicaid ID and we'll pull up
                your trips in seconds.
              </p>
            </div>
          )}

          {/* Floating lookup card */}
          <form
            onSubmit={handleSubmit}
            className={cn(
              "relative mt-6 rounded-2xl border border-border/60 bg-surface/95 p-4 shadow-lift backdrop-blur-xl",
              "animate-rise-in [animation-delay:160ms]",
              "sm:p-5",
            )}
          >
            <div className="space-y-3">
              <FieldGroup
                id="phone"
                label="Phone number"
                icon={<Phone className="h-4 w-4" />}
              >
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 border-transparent bg-transparent pl-9 text-base focus-visible:border-transparent focus-visible:ring-0"
                />
              </FieldGroup>

              <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              <FieldGroup
                id="mid"
                label="Medicaid ID"
                icon={<Sparkles className="h-4 w-4" />}
              >
                <Input
                  id="mid"
                  value={medicaid}
                  onChange={(e) => setMedicaid(e.target.value)}
                  placeholder="e.g. M964077"
                  className="h-11 border-transparent bg-transparent pl-9 text-base focus-visible:border-transparent focus-visible:ring-0"
                />
              </FieldGroup>

              <Button
                type="submit"
                disabled={loading}
                className="group relative h-12 w-full overflow-hidden rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-lift transition hover:brightness-110 active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Looking up your rides…
                  </>
                ) : (
                  <>
                    <Car className="mr-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    Look up my ride
                    <Search className="ml-2 h-4 w-4 opacity-80" />
                  </>
                )}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-12 bg-white/20 animate-glass-shimmer"
                />
              </Button>
            </div>
          </form>
        </div>
      </section>

      {passengerName && (
        <div className="text-sm text-muted-foreground animate-rise-in">
          Rides for <span className="font-medium text-foreground">{passengerName}</span>
        </div>
      )}

      {trips !== null && trips.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground animate-rise-in">
          No rides on file yet.
        </div>
      )}

      <div className="space-y-3">
        {(trips ?? []).map((t, i) => (
          <div
            key={t.id}
            className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-soft animate-rise-in"
            style={{ animationDelay: `${i * 60}ms` }}
          >
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
                  <a
                    href={`tel:${t.driver.phone}`}
                    className="rounded-full bg-primary p-2 text-primary-foreground transition hover:brightness-110"
                  >
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

function FieldGroup({
  id,
  label,
  icon,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="group rounded-xl border border-border/70 bg-surface-muted/70 px-3 py-2 transition-all focus-within:border-primary/50 focus-within:bg-surface focus-within:shadow-[0_0_0_4px_var(--color-ring)]">
      <Label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}
