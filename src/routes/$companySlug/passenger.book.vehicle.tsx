import { createFileRoute } from "@tanstack/react-router";
import { AppLink, useAppNavigate } from "@/lib/appLink";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, Car, Accessibility, Ambulance, Loader2, MapPin, CircleDot, Users, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passengerRequestRide, getVehicleEtas } from "@/lib/dispatch.functions";
import { updatePassengerIdentity } from "@/lib/passenger.functions";
import { getMyPassengerProfile } from "@/lib/passengerPublic.functions";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseBrowser";
import { getCompanySlug } from "@/lib/companyContext";
import { guestRequestRide } from "@/lib/guestBooking.functions";

import { cn } from "@/lib/utils";


export const Route = createFileRoute("/$companySlug/passenger/book/vehicle")({
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
    stops: typeof s.stops === "string" ? s.stops : undefined,
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
  const navigate = useAppNavigate();
  const { user } = useAuth();
  const request = useServerFn(passengerRequestRide);
  const etas = useServerFn(getVehicleEtas);
  const fetchProfile = useServerFn(getMyPassengerProfile);
  const saveIdentity = useServerFn(updatePassengerIdentity);
  const guestBook = useServerFn(guestRequestRide);
  const { companySlug } = Route.useParams();

  const [selected, setSelected] = useState<VehicleKey>("ambulatory");
  const [etaMap, setEtaMap] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("");

  // Identity requirement: Medicaid ID OR (SSN + DOB).
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [hasIdentity, setHasIdentity] = useState(false);
  const [idMode, setIdMode] = useState<"medicaid" | "ssn">("medicaid");
  const [medicaidId, setMedicaidId] = useState("");
  const [ssn, setSsn] = useState("");
  const [dob, setDob] = useState("");

  const missingCoords = !s.pLat || !s.pLng || !s.dLat || !s.dLng;

  useEffect(() => {
    if (missingCoords) return;
    // ETAs must reflect only the booking company's fleet.
    void etas({ data: { lat: s.pLat, lng: s.pLng, company_slug: getCompanySlug() } })
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

  useEffect(() => {
    // Ensure a device_id exists so guests and signed-in users both have
    // a stable key to look up their saved profile / identity.
    let deviceId = "";
    if (typeof window !== "undefined") {
      deviceId = window.localStorage.getItem("passenger_device_id") ?? "";
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        window.localStorage.setItem("passenger_device_id", deviceId);
      }
    }
    if (!deviceId) {
      setIdentityLoaded(true);
      return;
    }
    void fetchProfile({ data: { device_id: deviceId } })
      .then((row) => {
        if (!row) return;
        // Guests are recognized on this device: reuse their saved contact info.
        setPhone((prev) => prev || (row.phone ?? ""));
        const savedName = [row.first_name, row.last_name]
          .filter((x) => x && x !== "Guest")
          .join(" ")
          .trim();
        setFirstName((prev) => prev || savedName);
        const mid = (row.medicaid_id ?? "").trim();
        const hasRealMedicaid =
          !!mid && !mid.startsWith("SELF-") && !mid.startsWith("WALK-");
        const hasSsnDob = !!row.ssn_last4 && !!row.date_of_birth;
        if (hasRealMedicaid) {
          setMedicaidId(mid);
          setIdMode("medicaid");
        } else if (hasSsnDob) {
          setDob(row.date_of_birth ?? "");
          setIdMode("ssn");
        }
        setHasIdentity(hasRealMedicaid || hasSsnDob);
      })
      .catch(() => {})
      .finally(() => setIdentityLoaded(true));
  }, [user, fetchProfile]);

  const identityReady =
    hasIdentity ||
    (idMode === "medicaid" && medicaidId.trim().length >= 3) ||
    (idMode === "ssn" && ssn.replace(/\D/g, "").length === 9 && /^\d{4}-\d{2}-\d{2}$/.test(dob));

  async function book() {
    if (missingCoords) {
      toast.error("Missing pickup/dropoff. Please go back and pick both.");
      return;
    }
    if (!identityReady) {
      toast.error("Enter your Medicaid ID, or full SSN + date of birth.");
      return;
    }
    if (!user && !phone.trim()) {
      toast.error("Enter a phone number so the driver can reach you.");
      return;
    }
    setSubmitting(true);
    try {
      // Save/refresh identity if not already on file (or if user just edited it).
      if (user && !hasIdentity) {
        if (idMode === "medicaid") {
          await saveIdentity({ data: { medicaid_id: medicaidId.trim() } });
        } else {
          await saveIdentity({ data: { ssn, date_of_birth: dob } });
        }
        setHasIdentity(true);
      }

      const taggedNote = `[VEHICLE:${selected}]${s.notes ? `\n${s.notes}` : ""}`;
      let parsedStops: Array<{ address: string; lat: number; lng: number }> = [];
      if (s.stops) {
        try {
          const arr = JSON.parse(s.stops);
          if (Array.isArray(arr)) {
            parsedStops = arr
              .filter((x) => x && typeof x.address === "string" && typeof x.lat === "number" && typeof x.lng === "number")
              .map((x) => ({ address: x.address, lat: x.lat, lng: x.lng }));
          }
        } catch {
          // ignore malformed stops param
        }
      }
      const commonStops = parsedStops;
      const res = user
        ? await request({
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
          stops: commonStops,
        },
      })
        : await guestBook({
            data: {
              device_id:
                (typeof window !== "undefined"
                  ? window.localStorage.getItem("passenger_device_id")
                  : "") ?? "",
              company_slug: getCompanySlug() ?? companySlug,
              contact_name: firstName || null,
              contact_phone: phone,
              medicaid_id: idMode === "medicaid" ? medicaidId.trim() : null,
              ssn: idMode === "ssn" ? ssn : null,
              date_of_birth: idMode === "ssn" ? dob : null,
              pickup_address: s.pickup,
              pickup_lat: s.pLat,
              pickup_lng: s.pLng,
              dropoff_address: s.dropoff,
              dropoff_lat: s.dLat,
              dropoff_lng: s.dLng,
              notes: taggedNote,
              ride_purpose: s.purpose || null,
              stops: commonStops,
            },
          });
      // Clear persisted booking draft — successfully submitted.
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("passenger_booking_draft");
      }
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
          <AppLink
            to="/passenger/book/pickup"
            search={{
              pickup: s.pickup, pLat: s.pLat, pLng: s.pLng,
              dropoff: s.dropoff, dLat: s.dLat, dLng: s.dLng,
              notes: s.notes, purpose: s.purpose, stops: s.stops,
            }}
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-surface/80 text-foreground"
            aria-label="Edit locations"
          >
            <ChevronLeft className="h-4 w-4" />
          </AppLink>
          <button
            onClick={() => navigate({ to: "/passenger/book/pickup", search: {
              pickup: s.pickup, pLat: s.pLat, pLng: s.pLng,
              dropoff: s.dropoff, dLat: s.dLat, dLng: s.dLng,
              notes: s.notes, purpose: s.purpose, stops: s.stops,
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

      {/* Identity — Medicaid ID OR (SSN + DOB). Hidden once on file. */}
      {identityLoaded && !hasIdentity && (
        <div className="mx-auto max-w-2xl px-4 pb-4">
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold">Verify your Medicaid coverage</h3>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Required by Health First Colorado. Your SSN is stored encrypted and only used to
              generate your trip report.
            </p>

            <div className="mb-3 grid grid-cols-2 gap-2 rounded-full bg-surface-muted p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setIdMode("medicaid")}
                className={cn(
                  "rounded-full py-1.5 transition",
                  idMode === "medicaid" ? "bg-background shadow-soft" : "text-muted-foreground",
                )}
              >
                Medicaid ID
              </button>
              <button
                type="button"
                onClick={() => setIdMode("ssn")}
                className={cn(
                  "rounded-full py-1.5 transition",
                  idMode === "ssn" ? "bg-background shadow-soft" : "text-muted-foreground",
                )}
              >
                SSN + DOB
              </button>
            </div>

            {idMode === "medicaid" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Health First Colorado ID</Label>
                <Input
                  value={medicaidId}
                  onChange={(e) => setMedicaidId(e.target.value)}
                  placeholder="e.g. A123456789"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Social Security Number</Label>
                  <Input
                    value={ssn}
                    onChange={(e) => setSsn(e.target.value.replace(/[^\d-]/g, ""))}
                    placeholder="XXX-XX-XXXX"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={11}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date of birth</Label>
                  <Input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Guest contact — no account required to book. */}
      {!user && (
        <div className="mx-auto max-w-2xl px-4 pb-4">
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <h3 className="mb-1 text-sm font-semibold">Your contact info</h3>
            <p className="mb-3 text-[11px] text-muted-foreground">
              No account needed — we only use this so your driver can reach you.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First and last name"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky confirm */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <Button
            onClick={book}
            disabled={
              submitting ||
              missingCoords ||
              !identityLoaded ||
              !identityReady ||
              (!user && !phone.trim())
            }
            className="h-14 w-full rounded-full text-base font-semibold shadow-lift"
          >
            {submitting ? (
              <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Requesting…</>
            ) : !identityLoaded ? (
              <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking your coverage…</>
            ) : !identityReady ? (
              <>Enter Medicaid ID or SSN + DOB</>
            ) : !user && !phone.trim() ? (
              <>Enter your phone number</>
            ) : (
              <>Select {selectedLabel}</>
            )}
          </Button>
        </div>
      </div>

    </div>
  );
}
