import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, CalendarClock, MapPin, PlusCircle, Navigation, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useCurrentPosition } from "@/lib/useGeolocation";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export const Route = createFileRoute("/passenger/")({
  ssr: false,
  component: PassengerHome,
});


type RecentTrip = { id: string; dropoff_address: string; created_at: string };

function PassengerHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
    void navigate({ to: "/passenger/book/pickup", search: extra ?? {} });
  }

  function pickRecent(addr: string) {
    void navigate({ to: "/passenger/book/pickup", search: { dropoff: addr } });
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
        <Link
          to="/passenger/apply"
          className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-soft transition hover:border-primary/60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
            <CalendarClock className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Schedule ahead</span>
            <span className="block text-[11px] text-muted-foreground">Book a future ride</span>
          </span>
        </Link>
        <Link
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
        </Link>
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
  onOpen,
}: {
  onPick: (address: string, lat: number, lng: number) => void;
  onOpen: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Search className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <AddressAutocomplete
            value={value}
            onChange={setValue}
            onResolve={(p) => onPick(p.address, p.lat, p.lng)}
            placeholder="Where are you going?"
          />
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="hidden shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-xs text-muted-foreground transition hover:text-foreground sm:inline-flex"
          aria-label="Open full booking"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

