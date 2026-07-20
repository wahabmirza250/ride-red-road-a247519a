import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, MapPin, StickyNote, Loader2, Crosshair, Plus, X, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useCurrentPosition } from "@/lib/useGeolocation";
import { geocodeAddress, reverseGeocode } from "@/lib/geocode.functions";

export type BookingStop = { address: string; lat: number | null; lng: number | null };

function parseStops(v: unknown): BookingStop[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.address === "string")
      .map((x) => ({
        address: String(x.address),
        lat: typeof x.lat === "number" ? x.lat : null,
        lng: typeof x.lng === "number" ? x.lng : null,
      }));
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/passenger/book/pickup")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    dropoff: typeof s.dropoff === "string" ? s.dropoff : undefined,
    dLat: typeof s.dLat === "number" ? s.dLat : undefined,
    dLng: typeof s.dLng === "number" ? s.dLng : undefined,
    pickup: typeof s.pickup === "string" ? s.pickup : undefined,
    pLat: typeof s.pLat === "number" ? s.pLat : undefined,
    pLng: typeof s.pLng === "number" ? s.pLng : undefined,
    notes: typeof s.notes === "string" ? s.notes : undefined,
    purpose: typeof s.purpose === "string" ? s.purpose : undefined,
    stops: typeof s.stops === "string" ? s.stops : undefined,
  }),
  component: ConfirmPickup,
});

function ConfirmPickup() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { pos, err: geoErr } = useCurrentPosition();

  // Destination
  const [dropoff, setDropoff] = useState(search.dropoff ?? "");
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(
    search.dLat != null && search.dLng != null ? { lat: search.dLat, lng: search.dLng } : null,
  );

  // Pickup
  const [pickup, setPickup] = useState(search.pickup ?? "");
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(
    search.pLat != null && search.pLng != null ? { lat: search.pLat, lng: search.pLng } : null,
  );
  const [note, setNote] = useState(search.notes ?? "");
  const [purpose, setPurpose] = useState(search.purpose ?? "");
  const [autoLocating, setAutoLocating] = useState(!pickup);
  const [resolving, setResolving] = useState(false);

  // Reverse-geocode the passenger's current position → real street address.
  useEffect(() => {
    if (pickup || !pos) return;
    setPickupCoords({ lat: pos.lat, lng: pos.lng });
    setPickup(`Current location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`);
    setAutoLocating(false);
    (async () => {
      try {
        const r = await reverseGeocode({ data: { lat: pos.lat, lng: pos.lng } });
        if (r) {
          setPickup(r.address);
          setPickupCoords({ lat: r.lat, lng: r.lng });
        }
      } catch (e) {
        console.warn("Reverse geocode failed", e);
      }
    })();
  }, [pos, pickup]);

  useEffect(() => {
    if (!pos && geoErr) setAutoLocating(false);
  }, [pos, geoErr]);

  async function useCurrentLocation() {
    if (!pos) {
      toast.error(geoErr ?? "Location unavailable. Please allow location access or type an address.");
      return;
    }
    setPickupCoords({ lat: pos.lat, lng: pos.lng });
    setPickup(`Current location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`);
    try {
      const r = await reverseGeocode({ data: { lat: pos.lat, lng: pos.lng } });
      if (r) {
        setPickup(r.address);
        setPickupCoords({ lat: r.lat, lng: r.lng });
      }
    } catch (e) {
      console.warn("Reverse geocode failed", e);
    }
  }

  const hasPickup = !!pickup.trim();
  const hasDropoff = !!dropoff.trim();

  async function next() {
    if (!hasPickup || !hasDropoff) {
      toast.error("Please enter both a pickup and destination address.");
      return;
    }
    if (!purpose) {
      toast.error("Please choose the purpose of this ride.");
      return;
    }
    setResolving(true);
    try {
      let pc = pickupCoords;
      let dc = dropoffCoords;
      let pAddr = pickup;
      let dAddr = dropoff;

      if (!pc) {
        const g = await geocodeAddress({ data: { address: pickup } });
        if (!g) {
          toast.error("We couldn't find that pickup address. Try a more specific one.");
          setResolving(false);
          return;
        }
        pc = { lat: g.lat, lng: g.lng };
        pAddr = g.address;
        setPickup(g.address);
        setPickupCoords(pc);
      }
      if (!dc) {
        const g = await geocodeAddress({ data: { address: dropoff } });
        if (!g) {
          toast.error("We couldn't find that destination. Try a more specific one.");
          setResolving(false);
          return;
        }
        dc = { lat: g.lat, lng: g.lng };
        dAddr = g.address;
        setDropoff(g.address);
        setDropoffCoords(dc);
      }

      void navigate({
        to: "/passenger/book/vehicle",
        search: {
          pickup: pAddr,
          pLat: pc.lat,
          pLng: pc.lng,
          dropoff: dAddr,
          dLat: dc.lat,
          dLng: dc.lng,
          notes: note || undefined,
          purpose,
        },
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not look up that address. Please try again.");
    } finally {
      setResolving(false);
    }
  }

  const mapSrc = pickupCoords
    ? `https://www.google.com/maps?q=${pickupCoords.lat},${pickupCoords.lng}&z=16&output=embed`
    : "";

  return (
    <div className="relative -mx-4 -mt-4 min-h-[calc(100dvh-3.5rem)] pb-40">
      {/* Map */}
      <div className="relative h-[45dvh] w-full overflow-hidden bg-surface-muted">
        {pickupCoords ? (
          <iframe title="Pickup" src={mapSrc} className="h-full w-full border-0" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
            {autoLocating ? "Finding your location…" : "Enter a pickup address below or tap “Use my location.”"}
          </div>
        )}

        {/* Center pin */}
        {pickupCoords && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
            <div className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-lift">
              Recommended
            </div>
            <div className="mt-1 h-6 w-6 rounded-full bg-primary shadow-lift ring-4 ring-white" />
            <div className="-mt-1 h-3 w-3 rotate-45 bg-primary" />
          </div>
        )}

        <Link
          to="/passenger"
          className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-lift backdrop-blur"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>

        <button
          type="button"
          onClick={useCurrentLocation}
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 px-3 py-2 text-xs font-medium text-foreground shadow-lift backdrop-blur hover:bg-background"
        >
          <Crosshair className="h-3.5 w-3.5" /> Use my location
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="absolute inset-x-0 -mt-6 rounded-t-3xl border-t border-border bg-background px-4 pt-5 pb-6 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.25)]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
        <h2 className="text-lg font-semibold">Confirm pickup & destination</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a suggestion or type any address — we'll look it up for you.
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <MapPin className="h-4 w-4 text-emerald-500" /> Pickup location
            </Label>
            <AddressAutocomplete
              value={pickup}
              onChange={(v) => { setPickup(v); setPickupCoords(null); }}
              onResolve={(p) => { setPickup(p.address); setPickupCoords({ lat: p.lat, lng: p.lng }); }}
              placeholder="Start typing or paste an address…"
              biasLat={pos?.lat}
              biasLng={pos?.lng}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <MapPin className="h-4 w-4 text-rose-500" /> Destination
            </Label>
            <AddressAutocomplete
              value={dropoff}
              onChange={(v) => { setDropoff(v); setDropoffCoords(null); }}
              onResolve={(p) => { setDropoff(p.address); setDropoffCoords({ lat: p.lat, lng: p.lng }); }}
              placeholder="Where to?"
              biasLat={pos?.lat ?? pickupCoords?.lat}
              biasLng={pos?.lng ?? pickupCoords?.lng}
            />

          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Purpose of this ride</Label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            >
              <option value="">Select a purpose…</option>
              <option value="doctor">Doctor appointment</option>
              <option value="dialysis">Dialysis</option>
              <option value="physical_therapy">Physical therapy</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="mental_health">Mental health visit</option>
              <option value="other">Other</option>
            </select>
          </div>

          <details className="rounded-xl border border-border/60 bg-surface/60 px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
              <StickyNote className="h-3.5 w-3.5" /> Add note for driver
            </summary>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Wheelchair, appointment info, etc."
              className="mt-2"
            />
          </details>

          <Button
            onClick={next}
            disabled={!hasPickup || !hasDropoff || resolving}
            className="mt-2 h-12 w-full rounded-full text-base font-semibold"
          >
            {resolving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Looking up address…</>
            ) : (
              "Confirm pickup"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
