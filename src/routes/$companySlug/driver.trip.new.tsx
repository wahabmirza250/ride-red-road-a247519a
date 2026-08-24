import { createFileRoute } from "@tanstack/react-router";
import { useAppNavigate, useCompanySlug } from "@/lib/appLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Search,
  UserPlus,
  X,
  Loader2,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  History,
  AlertTriangle,
  WifiOff,
  Trash2,
} from "lucide-react";
import { getMyDriverDefaults, getAssignedTripForNemt } from "@/lib/nemtTrip.functions";
import { checkVehicleRates, verifyRiderIdentity } from "@/lib/manualTripSafety.functions";
import {
  beginVerify,
  completeVerify,
  failVerify,
  syncVerifyMapToRiders,
  verificationLabel,
  type VerifyEntry,
  type VerifyMap,
} from "@/lib/driverTripVerify";
import { startDriverTripDraft } from "@/lib/driverTripDrafts.functions";
import {
  addRiderSlot as addSlot,
  clearDraft,
  createEmptyDraft,
  draftLabel,
  draftStorageKey,
  firstIssue,
  isDraftEmpty,
  loadDraft,
  nowHM,
  pushRecentAddress,
  readRecentAddresses,
  removeRiderSlot,
  saveDraft,
  today,
  updateLeg as updateLegIn,
  validateCreateStage,
  validateDetailsStep,
  validatePassengerStep,
  withTripKind,
  type DraftRider,
  type DriverTripDraft,
  type FieldIssues,
} from "@/lib/driverTripDraft";
import { defaultLifecycle, type ActiveTripDraft } from "@/lib/driverTripLifecycle";

export const Route = createFileRoute("/$companySlug/driver/trip/new")({
  validateSearch: (search) => ({
    tripId: typeof (search as any).tripId === "string" ? ((search as any).tripId as string) : undefined,
  }),
  component: CreateTripScreen,
});

type SearchHit = DraftRider & { __source?: "passenger"; last_4_ssn?: string | null };

const VEHICLE_TYPES = [
  { value: "ambulatory", label: "Mobility / Ambulatory" },
  { value: "wheelchair_van", label: "Wheelchair Van" },
  { value: "stretcher_van", label: "Stretcher Van" },
  { value: "taxi", label: "Taxi" },
  { value: "ground_ambulance", label: "Ground Ambulance" },
];

const TRIP_KINDS = [
  { value: "one_way", label: "One way" },
  { value: "round_trip", label: "Round trip" },
  { value: "group_tour", label: "Group" },
] as const;

const STEPS = ["passenger", "route", "vehicle"] as const;
type CreateStep = (typeof STEPS)[number];
const STEP_LABELS: Record<CreateStep, string> = {
  passenger: "Passenger",
  route: "Pickup & destination",
  vehicle: "Vehicle",
};

/** Only what genuinely exists before the wheels turn is asked for here. */
function validateCreateStep(step: CreateStep, d: DriverTripDraft): FieldIssues {
  switch (step) {
    case "passenger":
      return validatePassengerStep(d);
    case "route": {
      const issues: FieldIssues = {};
      const l = d.legs[0];
      if (!l?.leg_date) issues["leg0.leg_date"] = "Pick the trip date";
      if (!l?.pickup_address.trim()) issues["leg0.pickup_address"] = "Pickup address is required";
      if (!l?.dropoff_address.trim()) issues["leg0.dropoff_address"] = "Destination is required";
      return issues;
    }
    case "vehicle":
      return validateDetailsStep(d);
  }
}

function CreateTripScreen() {
  const { tripId } = Route.useSearch();
  const { user, isDriver } = useAuth();
  const companySlug = useCompanySlug();
  const navigate = useAppNavigate();

  const [draft, setDraft] = useState<DriverTripDraft>(createEmptyDraft);
  const [step, setStep] = useState<CreateStep>("passenger");
  const [showErrors, setShowErrors] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [starting, setStarting] = useState(false);

  const storageKey = useMemo(
    () => draftStorageKey(companySlug, user?.id ?? null),
    [companySlug, user?.id],
  );

  /* -------------------------- local draft + autosave --------------------- */
  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const existing = loadDraft(window.localStorage, storageKey);
    if (existing && !isDraftEmpty(existing) && !(existing as any).server_draft_id) {
      setDraft(existing);
      setDraftRestored(true);
    }
    setHydrated(true);
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const t = setTimeout(() => saveDraft(window.localStorage, storageKey, draft), 400);
    return () => clearTimeout(t);
  }, [draft, hydrated, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setOnline(window.navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const patch = useCallback(
    (fn: (d: DriverTripDraft) => DriverTripDraft) => setDraft((d) => fn(d)),
    [],
  );

  /* ------------------------------ driver defaults ------------------------ */
  const loadDefaults = useServerFn(getMyDriverDefaults);
  useEffect(() => {
    loadDefaults()
      .then((d: any) => {
        if (!d) return;
        patch((prev) => ({
          ...prev,
          vehicle_type: prev.vehicle_type || d.default_vehicle_type || "",
          plate: prev.plate || d.default_plate || "",
          vin: prev.vin || d.default_vin || "",
          driver_full_name: d.driver_full_name || prev.driver_full_name,
        }));
      })
      .catch(() => {});
  }, [loadDefaults, patch]);

  /* ------------------------------ assigned trip -------------------------- */
  const loadAssignedTrip = useServerFn(getAssignedTripForNemt);
  const [assignedLoaded, setAssignedLoaded] = useState(false);
  useEffect(() => {
    if (!tripId || assignedLoaded || !hydrated) return;
    let cancelled = false;
    loadAssignedTrip({ data: { trip_id: tripId } })
      .then((prefill: any) => {
        if (cancelled) return;
        setAssignedLoaded(true);
        const scheduled = prefill.trip?.scheduled_pickup_time
          ? new Date(prefill.trip.scheduled_pickup_time)
          : new Date();
        const valid = !Number.isNaN(scheduled.getTime());
        const baseDate = valid ? scheduled.toISOString().slice(0, 10) : today();
        const baseTime = valid ? scheduled.toTimeString().slice(0, 5) : nowHM();
        patch((prev) => {
          let next: DriverTripDraft = { ...prev, assigned_trip_id: tripId };
          next = updateLegIn(next, 0, {
            leg_date: next.legs[0].leg_date || baseDate,
            pickup_time: next.legs[0].pickup_time || baseTime,
            pickup_address: next.legs[0].pickup_address || prefill.trip.pickup_address,
            dropoff_address: next.legs[0].dropoff_address || prefill.trip.dropoff_address,
          });
          if (prefill.rider) next = addSlot(next, prefill.rider as DraftRider);
          return next;
        });
        if (!prefill.rider && prefill.passenger?.full_name) {
          setRiderQuery(prefill.passenger.full_name);
          toast.info("Assigned address loaded — pick the passenger to continue.");
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load assigned trip"));
    return () => {
      cancelled = true;
    };
  }, [assignedLoaded, hydrated, loadAssignedTrip, patch, tripId]);

  /* --------------------------- passenger search -------------------------- */
  const [riderQuery, setRiderQuery] = useState("");
  const [riderResults, setRiderResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<DraftRider[]>([]);
  const [addingRider, setAddingRider] = useState(false);
  const [savingRider, setSavingRider] = useState(false);
  const [newRider, setNewRider] = useState({
    full_name: "",
    medicaid_id: "",
    dob: "",
    phone: "",
    last_4_ssn: "",
  });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: trips } = await supabase
        .from("medicaid_trips")
        .select("rider_id, created_at")
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      const ids = Array.from(new Set(((trips as any[]) ?? []).map((t) => t.rider_id).filter(Boolean)));
      if (ids.length === 0) return;
      const { data: riders } = await supabase.from("riders").select("*").in("id", ids.slice(0, 8));
      if (cancelled) return;
      const order = new Map(ids.map((id, i) => [id, i]));
      setRecent(
        (((riders as DraftRider[]) ?? []) as DraftRider[]).sort(
          (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
        ),
      );
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    const raw = riderQuery.trim();
    if (raw.length < 2) {
      setRiderResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const q = `%${raw}%`;
      const [ridersRes, passengersRes] = await Promise.all([
        supabase.from("riders").select("*").or(`full_name.ilike.${q},medicaid_id.ilike.${q}`).limit(6),
        supabase
          .from("passengers")
          .select("id,first_name,last_name,medicaid_id,date_of_birth,phone,ssn_last4")
          .or(`first_name.ilike.${q},last_name.ilike.${q},medicaid_id.ilike.${q},phone.ilike.${q}`)
          .limit(6),
      ]);
      const fromRiders = ((ridersRes.data as DraftRider[]) ?? []) as SearchHit[];
      const fromPassengers: SearchHit[] = (((passengersRes.data as any[]) ?? []) as any[]).map((p) => ({
        id: `passenger:${p.id}`,
        full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unnamed passenger",
        medicaid_id: p.medicaid_id ?? "",
        dob: p.date_of_birth ?? null,
        phone: p.phone ?? null,
        address: null,
        last_4_ssn: p.ssn_last4 ?? null,
        __source: "passenger" as const,
      }));
      const knownMedicaid = new Set(fromRiders.map((r) => r.medicaid_id).filter(Boolean));
      const merged = [
        ...fromRiders,
        ...fromPassengers.filter((p) => !p.medicaid_id || !knownMedicaid.has(p.medicaid_id)),
      ].slice(0, 8);
      if (!cancelled) {
        setRiderResults(merged);
        setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [riderQuery]);

  function attachRider(r: DraftRider) {
    setDraft((prev) => {
      if (prev.rider_slots.some((s) => s.rider.id === r.id)) return prev;
      if (prev.trip_kind !== "group_tour" && prev.rider_slots.length >= 1) {
        toast.info("Switch to Group to add more than one passenger");
        return prev;
      }
      return addSlot(prev, r);
    });
    setRiderQuery("");
    setRiderResults([]);
  }

  async function selectSearchResult(r: SearchHit) {
    if (r.__source !== "passenger") return attachRider(r);
    const medicaid = r.medicaid_id?.trim();
    if (medicaid) {
      const { data: existing } = await supabase
        .from("riders")
        .select("*")
        .eq("medicaid_id", medicaid)
        .maybeSingle();
      if (existing) return attachRider(existing as DraftRider);
    }
    const { data, error } = await supabase
      .from("riders")
      .insert({
        full_name: r.full_name,
        medicaid_id: medicaid || `SSN-${r.last_4_ssn ?? "0000"}`,
        dob: r.dob || null,
        phone: r.phone || null,
        last_4_ssn: medicaid ? null : (r.last_4_ssn ?? null),
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    if (!medicaid) {
      await supabase.rpc("copy_passenger_ssn_to_rider", {
        _passenger_id: r.id.replace("passenger:", ""),
        _rider_id: data.id,
      });
    }
    attachRider(data as DraftRider);
  }

  async function createNewRider() {
    if (!newRider.full_name.trim()) return toast.error("Full name is required");
    const hasMedicaid = !!newRider.medicaid_id.trim();
    const hasSsn = /^\d{4}$/.test(newRider.last_4_ssn);
    if (!hasMedicaid && !hasSsn) return toast.error("Enter a Medicaid ID or last 4 of SSN");
    setSavingRider(true);
    try {
      const { data, error } = await supabase
        .from("riders")
        .insert({
          full_name: newRider.full_name.trim(),
          medicaid_id: newRider.medicaid_id.trim() || `SSN-${newRider.last_4_ssn}`,
          dob: newRider.dob || null,
          phone: newRider.phone || null,
          last_4_ssn: hasMedicaid ? null : newRider.last_4_ssn || null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      attachRider(data as DraftRider);
      setAddingRider(false);
      setNewRider({ full_name: "", medicaid_id: "", dob: "", phone: "", last_4_ssn: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save passenger");
    } finally {
      setSavingRider(false);
    }
  }

  /* ------------------------------- addresses ----------------------------- */
  const [recentAddresses, setRecentAddresses] = useState<string[]>([]);
  useEffect(() => {
    if (typeof window !== "undefined") setRecentAddresses(readRecentAddresses(window.localStorage));
  }, []);

  function rememberAddress(a: string) {
    if (typeof window === "undefined" || !a.trim()) return;
    setRecentAddresses(pushRecentAddress(window.localStorage, a));
  }

  const [locating, setLocating] = useState(false);
  function useCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return toast.error("Location is not available on this device");
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        patch((d) =>
          updateLegIn(d, 0, { pickup_address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` }),
        );
        setLocating(false);
        toast.success("Current location added — edit it if you need a street address");
      },
      () => {
        setLocating(false);
        toast.error("Could not read your location");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  /* --------------------------- safety pre-flight ------------------------- */
  const runRateCheck = useServerFn(checkVehicleRates);
  const runRiderVerify = useServerFn(verifyRiderIdentity);
  const [rateCheck, setRateCheck] = useState<{ ok: boolean; missing: string[] } | null>(null);
  const [verify, setVerify] = useState<VerifyMap>({});

  useEffect(() => {
    if (!draft.vehicle_type) {
      setRateCheck(null);
      return;
    }
    let cancelled = false;
    runRateCheck({ data: { vehicle_type: draft.vehicle_type } })
      .then((r) => !cancelled && setRateCheck({ ok: r.ok, missing: r.missing }))
      .catch(() => !cancelled && setRateCheck({ ok: false, missing: ["trip", "mile"] }));
    return () => {
      cancelled = true;
    };
  }, [runRateCheck, draft.vehicle_type]);

  /* Medicaid verification stays OPTIONAL and MANUAL — selecting a passenger
     never starts a portal lookup. */
  const riderSlotIds = draft.rider_slots.map((s) => s.rider.id).join(",");
  useEffect(() => {
    const ids = riderSlotIds ? riderSlotIds.split(",") : [];
    setVerify((prev) => {
      const next = syncVerifyMapToRiders(prev, ids);
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [riderSlotIds]);

  function verifyRider(riderId: string) {
    let fire = false;
    setVerify((prev) => {
      const { next, shouldRequest } = beginVerify(prev, riderId);
      fire = shouldRequest;
      return next;
    });
    if (!fire) return;
    runRiderVerify({ data: { rider_id: riderId } })
      .then((result) => setVerify((p) => completeVerify(p, riderId, result)))
      .catch((e) =>
        setVerify((p) => failVerify(p, riderId, e instanceof Error ? e.message : "Verification failed")),
      );
  }

  const safetyIssue = useMemo(() => {
    if (draft.vehicle_type && rateCheck && !rateCheck.ok) {
      return `No billing rate configured for this vehicle type (missing: ${rateCheck.missing.join(", ")}). Ask billing to add it.`;
    }
    return null;
  }, [draft.vehicle_type, rateCheck]);

  /* ------------------------------ start trip ----------------------------- */
  const startTrip = useServerFn(startDriverTripDraft);
  async function handleStart() {
    const issues = validateCreateStage(draft);
    if (Object.keys(issues).length > 0) {
      setShowErrors(true);
      return toast.error(firstIssue(issues)!);
    }
    if (!online) return toast.error("You're offline — reconnect to start the trip");
    setStarting(true);
    try {
      const payload: ActiveTripDraft = {
        ...draft,
        rider_slots: draft.rider_slots.map((s) => ({ ...s, signature_data_url: null })),
        lifecycle: defaultLifecycle(),
      };
      const res: any = await startTrip({
        data: {
          label: draftLabel(draft),
          rider_id: draft.rider_slots[0]?.rider.id ?? null,
          assigned_trip_id: draft.assigned_trip_id,
          leg_date: draft.legs[0]?.leg_date ?? null,
          payload: payload as any,
        },
      });
      draft.legs.forEach((l) => {
        rememberAddress(l.pickup_address);
        rememberAddress(l.dropoff_address);
      });
      if (typeof window !== "undefined") clearDraft(window.localStorage, storageKey);
      toast.success(res?.reused ? "Resuming your open trip" : "Trip created — drive safe");
      navigate({ to: "/driver/trip/active", search: { draftId: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the trip");
    } finally {
      setStarting(false);
    }
  }

  if (!isDriver) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-muted-foreground">
        This flow is for drivers.
      </div>
    );
  }

  const issues = validateCreateStep(step, draft);
  const stepIndex = STEPS.indexOf(step);
  const err = (key: string) => (showErrors ? issues[key] : undefined);
  const leg = draft.legs[0];

  function goNext() {
    if (Object.keys(issues).length > 0) {
      setShowErrors(true);
      return toast.error(firstIssue(issues) ?? "Fill in the highlighted fields");
    }
    setShowErrors(false);
    if (step === "route") {
      rememberAddress(leg.pickup_address);
      rememberAddress(leg.dropoff_address);
    }
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="driver-cta-content-pad mx-auto flex max-w-lg flex-col">
      <div className="driver-step-header -mx-4 border-b bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              stepIndex === 0
                ? navigate({ to: "/driver" })
                : setStep(STEPS[Math.max(stepIndex - 1, 0)])
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              New trip · step {stepIndex + 1} of {STEPS.length}
            </div>
            <div className="truncate text-base font-semibold">{STEP_LABELS[step]}</div>
          </div>
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
        </div>
        <div className="mt-3 flex gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 py-4">
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
          Odometer readings, signatures and drop-off details are collected during the ride — you only
          set the trip up here.
        </div>

        {draftRestored && (
          <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
            <History className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-medium text-foreground">Draft restored</div>
              <div className="text-muted-foreground">We kept what you had entered.</div>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs"
              onClick={() => {
                if (typeof window !== "undefined") clearDraft(window.localStorage, storageKey);
                setDraft(createEmptyDraft());
                setDraftRestored(false);
                setStep("passenger");
              }}
            >
              <Trash2 className="h-3 w-3" /> Discard
            </button>
          </div>
        )}

        {/* ------------------------------ PASSENGER ------------------------ */}
        {step === "passenger" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {TRIP_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => patch((d) => withTripKind(d, k.value))}
                  className={`h-11 rounded-xl border text-sm font-medium transition-colors ${
                    draft.trip_kind === k.value ? "border-primary bg-primary/10 text-primary" : "bg-surface"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            {draft.rider_slots.length > 0 && (
              <div className="space-y-2">
                {draft.rider_slots.map((s) => (
                  <div key={s.rider.id} className="rounded-2xl border bg-surface p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.rider.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.rider.medicaid_id}
                          {s.rider.dob ? ` · DOB ${s.rider.dob}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove passenger"
                        className="flex h-9 w-9 items-center justify-center rounded-full border"
                        onClick={() => patch((d) => removeRiderSlot(d, s.rider.id))}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <VerifyBadge entry={verify[s.rider.id]} onVerify={() => verifyRider(s.rider.id)} />
                  </div>
                ))}
              </div>
            )}

            {(draft.trip_kind === "group_tour" || draft.rider_slots.length === 0) && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-12 pl-9 text-base"
                    inputMode="search"
                    enterKeyHint="search"
                    placeholder="Search name or Medicaid ID"
                    value={riderQuery}
                    onChange={(e) => setRiderQuery(e.target.value)}
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>

                {riderResults.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border bg-surface">
                    {riderResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => selectSearchResult(r)}
                        className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 active:bg-accent"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{r.full_name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {r.medicaid_id || `SSN ••••${r.last_4_ssn ?? ""}`}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}

                {riderQuery.trim().length >= 2 && !searching && riderResults.length === 0 && (
                  <div className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No passenger found for “{riderQuery.trim()}”.
                  </div>
                )}

                {recent.length > 0 && riderQuery.trim().length < 2 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <History className="h-3.5 w-3.5" /> Recent passengers
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recent.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => attachRider(r)}
                          className="rounded-full border bg-surface px-3 py-2 text-sm active:bg-accent"
                        >
                          {r.full_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!addingRider ? (
                  <Button variant="outline" className="h-12 w-full" onClick={() => setAddingRider(true)}>
                    <UserPlus className="mr-2 h-4 w-4" /> Add new passenger
                  </Button>
                ) : (
                  <div className="space-y-3 rounded-2xl border bg-surface p-3">
                    <Field label="Full name">
                      <Input
                        className="h-12 text-base"
                        autoFocus
                        value={newRider.full_name}
                        onChange={(e) => setNewRider({ ...newRider, full_name: e.target.value })}
                      />
                    </Field>
                    <Field label="Medicaid ID">
                      <Input
                        className="h-12 text-base"
                        autoCapitalize="characters"
                        value={newRider.medicaid_id}
                        onChange={(e) => setNewRider({ ...newRider, medicaid_id: e.target.value })}
                      />
                    </Field>
                    <Field label="or last 4 of SSN">
                      <Input
                        className="h-12 text-base"
                        inputMode="numeric"
                        maxLength={4}
                        value={newRider.last_4_ssn}
                        onChange={(e) => setNewRider({ ...newRider, last_4_ssn: e.target.value })}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Date of birth">
                        <Input
                          type="date"
                          className="h-12 text-base"
                          value={newRider.dob}
                          onChange={(e) => setNewRider({ ...newRider, dob: e.target.value })}
                        />
                      </Field>
                      <Field label="Phone">
                        <Input
                          type="tel"
                          inputMode="tel"
                          className="h-12 text-base"
                          value={newRider.phone}
                          onChange={(e) => setNewRider({ ...newRider, phone: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="h-11 flex-1" onClick={() => setAddingRider(false)}>
                        Cancel
                      </Button>
                      <Button className="h-11 flex-1" onClick={createNewRider} disabled={savingRider}>
                        {savingRider && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {err("riders") && <InlineError message={err("riders")!} />}
          </div>
        )}

        {/* -------------------------------- ROUTE -------------------------- */}
        {step === "route" && leg && (
          <div className="space-y-3 rounded-2xl border bg-surface p-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date">
                <Input
                  type="date"
                  className="h-12 text-base"
                  value={leg.leg_date}
                  onChange={(e) => patch((d) => updateLegIn(d, 0, { leg_date: e.target.value }))}
                />
              </Field>
              <Field label="Pickup time (optional now)">
                <div className="flex gap-2">
                  <Input
                    type="time"
                    className="h-12 text-base"
                    value={leg.pickup_time}
                    onChange={(e) => patch((d) => updateLegIn(d, 0, { pickup_time: e.target.value }))}
                  />
                  <button
                    type="button"
                    aria-label="Set pickup time to now"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border"
                    onClick={() => patch((d) => updateLegIn(d, 0, { pickup_time: nowHM() }))}
                  >
                    <Clock className="h-4 w-4" />
                  </button>
                </div>
              </Field>
            </div>
            {err("leg0.leg_date") && <InlineError message={err("leg0.leg_date")!} />}

            <Field label="Pickup address">
              <AddressAutocomplete
                value={leg.pickup_address}
                onChange={(v) => patch((d) => updateLegIn(d, 0, { pickup_address: v }))}
                onResolve={(p: any) =>
                  patch((d) => updateLegIn(d, 0, { pickup_address: p.address ?? p.description ?? "" }))
                }
                placeholder="Where you are picking them up"
              />
            </Field>
            <button
              type="button"
              onClick={useCurrentLocation}
              className="flex items-center gap-1.5 text-xs font-medium text-primary"
            >
              {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              Use my current location
            </button>
            {err("leg0.pickup_address") && <InlineError message={err("leg0.pickup_address")!} />}

            <Field label="Destination">
              <AddressAutocomplete
                value={leg.dropoff_address}
                onChange={(v) => patch((d) => updateLegIn(d, 0, { dropoff_address: v }))}
                onResolve={(p: any) =>
                  patch((d) => updateLegIn(d, 0, { dropoff_address: p.address ?? p.description ?? "" }))
                }
                placeholder="Where the ride ends"
              />
            </Field>
            {recentAddresses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {recentAddresses.slice(0, 4).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => patch((d) => updateLegIn(d, 0, { dropoff_address: a }))}
                    className="max-w-full truncate rounded-full border px-2.5 py-1.5 text-xs text-muted-foreground active:bg-accent"
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
            {err("leg0.dropoff_address") && <InlineError message={err("leg0.dropoff_address")!} />}

            {draft.trip_kind === "round_trip" && (
              <p className="text-[11px] text-muted-foreground">
                Round trip: the return leg opens after you complete this one — you do not enter it now.
              </p>
            )}
          </div>
        )}

        {/* ------------------------------- VEHICLE ------------------------- */}
        {step === "vehicle" && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-2xl border bg-surface p-3">
              <Field label="Vehicle type">
                <Select
                  value={draft.vehicle_type}
                  onValueChange={(v) => patch((d) => ({ ...d, vehicle_type: v }))}
                >
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder="Select vehicle type" />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPES.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {err("vehicle_type") && <InlineError message={err("vehicle_type")!} />}

              <Field label="License plate">
                <Input
                  className="h-12 text-base uppercase"
                  autoCapitalize="characters"
                  value={draft.plate}
                  onChange={(e) => patch((d) => ({ ...d, plate: e.target.value }))}
                  placeholder="ABC-1234"
                />
              </Field>
              {err("plate") && <InlineError message={err("plate")!} />}

              {safetyIssue && (
                <div className="flex gap-2 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{safetyIssue}</span>
                </div>
              )}
            </div>

            <details className="rounded-2xl border bg-surface p-3">
              <summary className="cursor-pointer text-sm font-medium">Optional details</summary>
              <div className="mt-3 space-y-3">
                <Field label="VIN">
                  <Input
                    className="h-12 text-base"
                    value={draft.vin}
                    onChange={(e) => patch((d) => ({ ...d, vin: e.target.value }))}
                  />
                </Field>
                <Field label="Escort / attendant name">
                  <Input
                    className="h-12 text-base"
                    value={draft.escort_name}
                    onChange={(e) => patch((d) => ({ ...d, escort_name: e.target.value }))}
                  />
                </Field>
                <Field label="Driver name on the form">
                  <Input
                    className="h-12 text-base"
                    value={draft.driver_full_name}
                    onChange={(e) => patch((d) => ({ ...d, driver_full_name: e.target.value }))}
                  />
                </Field>
              </div>
            </details>
          </div>
        )}
      </div>

      {/* Single sticky CTA layer above the driver nav pill */}
      <div className="driver-cta-bar -mx-4 border-t bg-background/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {step === "vehicle" ? (
            <Button className="h-14 w-full text-base" onClick={handleStart} disabled={starting || !online}>
              {starting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {starting ? "Creating…" : "Create trip & start driving"}
            </Button>
          ) : (
            <Button className="h-14 w-full text-base" onClick={goNext}>
              Continue
              <ChevronRight className="ml-1 h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function VerifyBadge({ entry, onVerify }: { entry?: VerifyEntry; onVerify: () => void }) {
  const label = verificationLabel(entry);
  const running = label === "Checking…";
  const tone =
    label === "Verified"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : label === "Not checked" || label === "Checking…"
        ? "bg-muted text-muted-foreground"
        : label === "Unavailable"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-red-500/10 text-red-700 dark:text-red-300";

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ${tone}`}>
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : label === "Verified" ? (
            <Check className="h-3 w-3" />
          ) : null}
          Medicaid: {label}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-full text-xs"
          disabled={running}
          onClick={onVerify}
        >
          {running ? "Verifying…" : label === "Not checked" ? "Verify Medicaid" : "Re-check"}
        </Button>
      </div>
      {running && (
        <p className="text-[11px] text-muted-foreground">
          Portal check runs in the background (1–3 min) — keep going, it never blocks the trip.
        </p>
      )}
      {!running && entry?.result?.message && (
        <p className="text-[11px] text-muted-foreground">{entry.result.message}</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  );
}
