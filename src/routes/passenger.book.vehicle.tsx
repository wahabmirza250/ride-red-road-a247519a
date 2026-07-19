import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, Car, Accessibility, Ambulance, Loader2, MapPin, CircleDot, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { passengerRequestRide, getVehicleEtas } from "@/lib/dispatch.functions";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseBrowser";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/passenger/book/vehicle")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    pickup: typeof s.pickup === "string" ? s.pickup : "",
    pLat: typeof s.pLat === "number" ? s.pLat : 0,
    pLng: typeof s.pLng === "number" ? s.pLng : 0,
    dropoff: typeof s.dropoff === "string" ? s.dropoff : "",
    dLat: typeof s.dLat === "number" ? s.dLat : 0,
    dLng: typeof s.dLng === "number" ? s.dLng : 0,
    notes: typeof s.notes === "string" ? s.notes : undefined,
    purpose: typeof s.purpose === "string" ? s.purpose : undefined,
  }),
  component: VehicleSelect,
});

type VehicleKey = "ambulatory" | "wheelchair_van" | "stretcher_van";

const VEHICLES: {
  key: VehicleKey;
  label: string;
  desc: string;
  icon: typeof Car;
  capacity: number;
}[] = [
  { key: "ambulatory", label: "Regular Car", desc: "Sedan for standard rides", icon: Car, capacity: 4 },
  { key: "wheelchair_van", label: "Wheelchair Van", desc: "Ramp-equipped, secures 1 wheelchair", icon: Accessibility, capacity: 3 },
  { key: "stretcher_van", label: "Stretcher Van", desc: "Non-emergency stretcher transport", icon: Ambulance, capacity: 2 },
];

function VehicleSelect() {
  const s = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const request = useServerFn(passengerRequestRide);
  const etas = useServerFn(getVehicleEtas);

  const [selected, setSelected] = useState<VehicleKey>("ambulatory");
  const [etaMap, setEtaMap] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("");

  const missingCoords = !s.pLat || !s.pLng || !s.dLat || !s.dLng;

  useEffect(() => {
    if (missingCoords) return;
    void etas({ data: { lat: s.pLat, lng: s.pLng } })
      .then((r) => setEtaMap(r as Record<string, number>))
      .catch(() => setEtaMap({}));
  }, [etas, s.pLat, s.pLng, missingCoords]);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("first_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.phone) setPhone(data.phone);
        if (data?.first_name) setFirstName(data.first_name);
      });
  }, [user]);

  async function book() {
    if (missingCoords) {
      toast.error("Missing pickup/dropoff. Please go back and pick both.");
      return;
    }
    if (!user) {
      toast.error("Sign in to book a ride.");
      void navigate({ to: "/passenger/signup" });
      return;
    }
    setSubmitting(true);
    try {
      // Vehicle type flows through notes as a leading tag so existing dispatch
      // logic keeps working without a schema change. Drivers see the human note.
      const taggedNote = `[VEHICLE:${selected}]${s.notes ? `\n${s.notes}` : ""}`;
      const res = await request({
        data: {
          pickup_address: s.pickup,
          pickup_lat: s.pLat,
          pickup_lng: s.pLng,
          dropoff_address: s.dropoff,
          dropoff_lat: s.dLat,
          dropoff_lng: s.dLng,
          notes: taggedNote,
          contact_name: firstName || null,
          contact_phone: phone || null,
          ride_purpose: s.purpose || null,
        },
      });
      void navigate({ to: "/ride/$requestId", params: { requestId: res.request_id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not book ride");
      setSubmitting(false);
    }
  }

  const selectedLabel = VEHICLES.find((v) => v.key === selected)?.label ?? "";

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100dvh-3.5rem)] bg-background pb-40">
      {/* Top: route summary */}
      <div className="sticky top-14 z-10 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-start gap-3">
          <Link
            to="/passenger/book/pickup"
            search={{
              pickup: s.pickup, pLat: s.pLat, pLng: s.pLng,
              dropoff: s.dropoff, dLat: s.dLat, dLng: s.dLng,
              notes: s.notes, purpose: s.purpose,
            }}
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-surface/80 text-foreground"
            aria-label="Edit locations"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <button
            onClick={() => navigate({ to: "/passenger/book/pickup", search: {
              pickup: s.pickup, pLat: s.pLat, pLng: s.pLng,
              dropoff: s.dropoff, dLat: s.dLat, dLng: s.dLng,
              notes: s.notes, purpose: s.purpose,
            } })}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl border border-border/60 bg-surface/70 p-3 text-left transition hover:bg-surface"
          >
            <div className="flex flex-col items-center gap-1 pt-1">
              <CircleDot className="h-3.5 w-3.5 text-emerald-500" />
              <span className="h-4 w-px bg-border" />
              <MapPin className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-tight">
              <div className="truncate font-medium">{s.pickup || "Pickup"}</div>
              <div className="truncate text-muted-foreground">{s.dropoff || "Destination"}</div>
              <div className="pt-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                Tap to edit locations
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Vehicle options */}
      <div className="mx-auto max-w-2xl space-y-2 p-4">
        <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Choose a vehicle
        </h2>
        {VEHICLES.map((v) => {
          const active = v.key === selected;
          const eta = etaMap[v.key];
          const Icon = v.icon;
          return (
            <button
              key={v.key}
              onClick={() => setSelected(v.key)}
              className={cn(
                "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition",
                active
                  ? "border-primary bg-primary/5 shadow-lift"
                  : "border-border bg-surface hover:border-primary/40",
              )}
            >
              <div className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl",
                active ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground",
              )}>
                <Icon className="h-7 w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">{v.label}</span>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Users className="h-3 w-3" /> {v.capacity}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{v.desc}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-muted-foreground">Pickup</div>
                <div className="text-sm font-semibold">
                  {eta != null ? `in ${eta} min` : "—"}
                </div>
              </div>
            </button>
          );
        })}
        <p className="px-1 pt-1 text-[11px] text-muted-foreground">
          Fixed-rate Medicaid transportation — no surge or tips.
        </p>
      </div>

      {/* Sticky confirm */}
      <div className="fixed inset-x-0 bottom-20 z-20 px-4 pb-2">
        <div className="mx-auto max-w-2xl">
          <Button
            onClick={book}
            disabled={submitting || missingCoords}
            className="h-14 w-full rounded-full text-base font-semibold shadow-lift"
          >
            {submitting ? (
              <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Requesting…</>
            ) : (
              <>Select {selectedLabel}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
