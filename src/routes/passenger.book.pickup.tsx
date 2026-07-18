import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, MapPin, StickyNote, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useCurrentPosition } from "@/lib/useGeolocation";

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
  }),
  component: ConfirmPickup,
});

function ConfirmPickup() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { pos } = useCurrentPosition();

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
  const [autoLocating, setAutoLocating] = useState(!pickup);

  // Reverse-geocode the passenger's current position → default pickup address.
  useEffect(() => {
    if (pickup || !pos) return;
    setPickupCoords({ lat: pos.lat, lng: pos.lng });
    const key = (import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined) ?? "";
    if (!key) {
      setPickup(`Current location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`);
      setAutoLocating(false);
      return;
    }
    fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${pos.lat},${pos.lng}&key=${key}`)
      .then((r) => r.json())
      .then((j) => {
        const addr = j?.results?.[0]?.formatted_address as string | undefined;
        if (addr) setPickup(addr);
        else setPickup(`Current location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`);
      })
      .catch(() => setPickup(`Current location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`))
      .finally(() => setAutoLocating(false));
  }, [pos, pickup]);

  const canContinue = !!pickup && !!pickupCoords && !!dropoff && !!dropoffCoords;

  function next() {
    if (!canContinue) return;
    void navigate({
      to: "/passenger/book/vehicle",
      search: {
        pickup,
        pLat: pickupCoords!.lat,
        pLng: pickupCoords!.lng,
        dropoff,
        dLat: dropoffCoords!.lat,
        dLng: dropoffCoords!.lng,
        notes: note || undefined,
      },
    });
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
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {autoLocating ? "Finding your location…" : "Enter a pickup address"}
          </div>
        )}

        {/* Center pin */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
          <div className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-lift">
            Recommended
          </div>
          <div className="mt-1 h-6 w-6 rounded-full bg-primary shadow-lift ring-4 ring-white" />
          <div className="-mt-1 h-3 w-3 rotate-45 bg-primary" />
        </div>

        <Link
          to="/passenger"
          className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-lift backdrop-blur"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      </div>

      {/* Bottom sheet */}
      <div className="absolute inset-x-0 -mt-6 rounded-t-3xl border-t border-border bg-background px-4 pt-5 pb-6 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.25)]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
        <h2 className="text-lg font-semibold">Confirm pickup spot</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag map or edit address to set your pickup
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
              placeholder="Start typing an address…"
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
            />
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
            disabled={!canContinue}
            className="mt-2 h-12 w-full rounded-full text-base font-semibold"
          >
            {autoLocating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Locating…</> : "Confirm pickup"}
          </Button>
        </div>
      </div>
    </div>
  );
}
