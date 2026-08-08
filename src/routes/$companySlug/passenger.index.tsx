import { createFileRoute } from "@tanstack/react-router";
import { AppLink, useAppNavigate } from "@/lib/appLink";
import { useEffect, useMemo, useState } from "react";
import { Search, CalendarClock, MapPin, PlusCircle, Navigation, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useCurrentPosition } from "@/lib/useGeolocation";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useServerFn } from "@tanstack/react-start";
import { listGuestRides } from "@/lib/guestBooking.functions";

export const Route = createFileRoute("/$companySlug/passenger/")({
  ssr: false,
  component: PassengerHome,
});


type RecentTrip = { id: string; dropoff_address: string; created_at: string };

function PassengerHome() {
  const { user } = useAuth();
  const navigate = useAppNavigate();
  const { pos } = useCurrentPosition();
  const [firstName, setFirstName] = useState<string>("");
  const [recent, setRecent] = useState<RecentTrip[]>([]);

  // Load profile name + recent dropoffs for signed-in passengers.
  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle();
      if (!cancel && prof?.first_name) setFirstName(prof.first_name);

      const { data: passenger } = await supabase.from("passengers").select("id").eq("user_id", user.id).maybeSingle();
      if (!passenger || cancel) return;
      const { data: trips } = await supabase
        .from("trips")
        .select("id, dropoff_address, created_at")
        .eq("passenger_id", passenger.id)
        .not("dropoff_address", "is", null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (!cancel) setRecent((trips ?? []) as RecentTrip[]);
    })();
    return () => { cancel = true; };
  }, [user]);

  // Guests are remembered on this device: greet them by name and show the
  // rides they booked without an account.
  const guestRides = useServerFn(listGuestRides);
  useEffect(() => {
    if (user) return;
    const deviceId = typeof window !== "undefined"
      ? window.localStorage.getItem("passenger_device_id")
      : null;
    if (!deviceId) return;
    let cancel = false;
    void guestRides({ data: { device_id: deviceId } })
      .then((r) => {
        if (cancel) return;
        if (r.first_name && r.first_name !== "Guest") setFirstName(r.first_name);
        setRecent(
          (r.rides ?? [])
            .filter((x) => !!x.dropoff_address)
            .map((x) => ({ id: x.id, dropoff_address: x.dropoff_address, created_at: x.created_at })),
        );
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [user, guestRides]);

  const greeting = useMemo(() => {
    const name = firstName || (user?.email ? user.email.split("@")[0] : "");
    return name ? `Hi there, ${name}` : "Hi there";
  }, [firstName, user]);

  const seenAddresses = new Set<string>();
  const uniqueRecent = recent.filter((r) => {
    const k = r.dropoff_address.trim().toLowerCase();
    if (seenAddresses.has(k)) return false;
    seenAddresses.add(k);
    return true;
  });

  function goToSearch(extra?: { dropoff?: string; dLat?: number; dLng?: number }) {
    void navigate({
      to: "/passenger/book/pickup",
      search: {
        dropoff: extra?.dropoff,
        dLat: extra?.dLat,
        dLng: extra?.dLng,
        pickup: undefined,
        pLat: undefined,
        pLng: undefined,
        notes: undefined,
        purpose: undefined,
        stops: undefined,
      },
    });
  }

  function pickRecent(addr: string) {
    void navigate({
      to: "/passenger/book/pickup",
      search: {
        dropoff: addr,
        dLat: undefined,
        dLng: undefined,
        pickup: undefined,
        pLat: undefined,
        pLng: undefined,
        notes: undefined,
        purpose: undefined,
        stops: undefined,
      },
    });
  }


  return (
    <div className="space-y-6 pb-6">
      <div className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-sm text-muted-foreground">Where would you like to go today?</p>
      </div>

      {/* Big "Where are you going?" search bar with live autocomplete */}
      <DestinationSearch
        onPick={(addr, lat, lng) => goToSearch({ dropoff: addr, dLat: lat, dLng: lng })}
        onSubmitRaw={(text) => goToSearch({ dropoff: text })}
      />



      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <AppLink
          to="/passenger/apply"
          search={{ dropoff: undefined, pickup: undefined, eventTitle: undefined }}
          className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-soft transition hover:border-primary/60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
            <CalendarClock className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Schedule ahead</span>
            <span className="block text-[11px] text-muted-foreground">Book a future ride</span>
          </span>
        </AppLink>
        <AppLink
          to="/passenger/track"
          className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-soft transition hover:border-primary/60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
            <MapPin className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Track a ride</span>
            <span className="block text-[11px] text-muted-foreground">Phone or Medicaid ID</span>
          </span>
        </AppLink>
      </div>

      {/* Saved / recent locations */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {uniqueRecent.length ? "Recent destinations" : "Saved places"}
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          {uniqueRecent.length === 0 ? (
            <button
              onClick={() => goToSearch()}
              className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-muted"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <PlusCircle className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">Add a location</span>
                <span className="block text-[11px] text-muted-foreground">
                  Book your first ride to save destinations
                </span>
              </span>
            </button>
          ) : (
            uniqueRecent.map((r, i) => (
              <button
                key={r.id}
                onClick={() => pickRecent(r.dropoff_address)}
                className={`flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-muted ${
                  i > 0 ? "border-t border-border/60" : ""
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.dropoff_address}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </section>

      {/* You are here */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Navigation className="h-3.5 w-3.5" /> You are here
        </h2>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <div className="h-40 w-full">
            {pos ? (
              <iframe
                title="Your location"
                className="h-full w-full border-0"
                src={`https://www.google.com/maps?q=${pos.lat},${pos.lng}&z=15&output=embed`}
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface-muted text-xs text-muted-foreground">
                Fetching your location…
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500/60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-500 ring-2 ring-white" />
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function DestinationSearch({
  onPick,
  onSubmitRaw,
}: {
  onPick: (address: string, lat: number, lng: number) => void;
  onSubmitRaw: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const canSubmit = value.trim().length >= 3;
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
      <div className="flex items-center gap-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Search className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <AddressAutocomplete
            value={value}
            onChange={setValue}
            onResolve={(p) => onPick(p.address, p.lat, p.lng)}
            onSubmit={(raw) => onSubmitRaw(raw)}
            placeholder="Where are you going?"
          />
        </div>
        <button
          type="button"
          onClick={() => (canSubmit ? onSubmitRaw(value.trim()) : null)}
          disabled={!canSubmit}
          className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition disabled:opacity-40"
          aria-label="Search destination"
        >
          Go
        </button>
      </div>
      <p className="mt-2 px-1 text-[11px] text-muted-foreground">
        Pick a suggestion, tap Go, or press Enter — we'll look it up for you.
      </p>
    </div>
  );
}


