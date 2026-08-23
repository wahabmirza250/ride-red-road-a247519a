import { createFileRoute } from "@tanstack/react-router";
import { useAppNavigate, useCompanySlug } from "@/lib/appLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { SignaturePad } from "@/components/driver/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Switch } from "@/components/ui/switch";
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
  Camera,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  History,
  FileText,
  AlertTriangle,
  WifiOff,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import {
  createNemtTripGroup,
  attachRiderSignature,
  attachStatePdf,
  getMyDriverDefaults,
  getAssignedTripForNemt,
  detectOdometerFromImage,
} from "@/lib/nemtTrip.functions";
import { generateStateFormPdf } from "@/lib/medicaidPdf";
import { getRiderIdentifierForPdf } from "@/lib/rider.functions";
import {
  checkVehicleRates,
  verifyRiderIdentity,
} from "@/lib/manualTripSafety.functions";
import {
  beginVerify,
  completeVerify,
  failVerify,
  syncVerifyMapToRiders,
  verificationLabel,
  verificationWarnings,
  type VerifyEntry,
  type VerifyMap,
} from "@/lib/driverTripVerify";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import {
  saveDriverTripDraft,
  getDriverTripDraft,
  closeDriverTripDraft,
} from "@/lib/driverTripDrafts.functions";
import {
  STEPS,
  STEP_LABELS,
  addRiderSlot as addSlot,
  buildCreateTripPayload,
  buildPdfArgs,
  clearDraft,
  completedSteps,
  createEmptyDraft,
  draftLabel,
  draftStorageKey,
  firstIssue,
  isDraftEmpty,
  isDraftSavable,
  loadDraft,
  legMiles,
  missingForCompletion,
  nowHM,

  pushRecentAddress,
  readRecentAddresses,
  removeRiderSlot,
  saveDraft,
  today,
  updateLeg as updateLegIn,
  updateSlot as updateSlotIn,
  validateSaveStage,
  validateStep,
  validateStepForNavigation,
  withTripKind,
  type DraftRider,
  type DriverTripDraft,
  type Step,
} from "@/lib/driverTripDraft";

export const Route = createFileRoute("/$companySlug/driver/trip/new")({
  validateSearch: (search) => ({
    tripId: typeof search.tripId === "string" ? search.tripId : undefined,
    draftId: typeof (search as any).draftId === "string" ? ((search as any).draftId as string) : undefined,
  }),
  component: NewNemtTripWizard,
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

function NewNemtTripWizard() {
  const { tripId } = Route.useSearch();
  const { user, isDriver } = useAuth();
  const companySlug = useCompanySlug();
  const navigate = useAppNavigate();

  const [draft, setDraft] = useState<DriverTripDraft>(createEmptyDraft);
  const [step, setStep] = useState<Step>("passenger");
  const [showErrors, setShowErrors] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);

  const storageKey = useMemo(
    () => draftStorageKey(companySlug, user?.id ?? null),
    [companySlug, user?.id],
  );

  /* -------------------------- draft restore + autosave ------------------- */
  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const existing = loadDraft(window.localStorage, storageKey);
    if (existing && !isDraftEmpty(existing)) {
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
        supabase
          .from("riders")
          .select("*")
          .or(`full_name.ilike.${q},medicaid_id.ilike.${q}`)
          .limit(6),
        supabase
          .from("passengers")
          .select("id,first_name,last_name,medicaid_id,date_of_birth,phone,ssn_last4")
          .or(
            `first_name.ilike.${q},last_name.ilike.${q},medicaid_id.ilike.${q},phone.ilike.${q}`,
          )
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
    // Passenger-table hit — reuse or materialize the matching rider row.
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
    if (typeof window === "undefined") return;
    setRecentAddresses(pushRecentAddress(window.localStorage, a));
  }

  const [locating, setLocating] = useState(false);
  async function useCurrentLocation(legIdx: number) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return toast.error("Location is not available on this device");
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        patch((d) =>
          updateLegIn(d, legIdx, {
            pickup_address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          }),
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

  /* ------------------------------- odometer OCR -------------------------- */
  const detectOdometer = useServerFn(detectOdometerFromImage);
  const [detecting, setDetecting] = useState<Record<string, boolean>>({});
  async function handleOdometerPhoto(
    legIndex: number,
    field: "pickup_odometer" | "dropoff_odometer",
    file: File | null,
  ) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an odometer photo");
    if (file.size > 6 * 1024 * 1024) return toast.error("Photo is too large — use a smaller image");
    const key = `${legIndex}-${field}`;
    setDetecting((p) => ({ ...p, [key]: true }));
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const result = await detectOdometer({ data: { image_data_url: imageDataUrl } });
      if (!result.odometer) return toast.error("Could not read the odometer — type it in");
      patch((d) => updateLegIn(d, legIndex, { [field]: result.odometer } as any));
      toast.success(`Odometer detected: ${result.odometer}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not detect odometer");
    } finally {
      setDetecting((p) => ({ ...p, [key]: false }));
    }
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

  /* Medicaid verification is OPTIONAL and MANUAL here — selecting a passenger
     never starts a portal lookup; we only drop state for removed riders. */
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
        setVerify((p) =>
          failVerify(p, riderId, e instanceof Error ? e.message : "Verification failed"),
        ),
      );
  }

  /** Only real blockers live here — verification never blocks the driver. */
  const safetyIssue = useMemo(() => {
    if (draft.vehicle_type && rateCheck && !rateCheck.ok) {
      return `No billing rate configured for this vehicle type (missing: ${rateCheck.missing.join(", ")}). Ask billing to add it.`;
    }
    return null;
  }, [draft.vehicle_type, rateCheck]);

  const verifyWarnings = useMemo(
    () =>
      verificationWarnings(
        verify,
        draft.rider_slots.map((s) => ({ id: s.rider.id, name: s.rider.full_name })),
      ),
    [verify, draft.rider_slots],
  );

  /* --------------------------------- submit ------------------------------ */
  const submitGroup = useServerFn(createNemtTripGroup);
  const attachSig = useServerFn(attachRiderSignature);
  const attachPdf = useServerFn(attachStatePdf);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState("");
  const [completedPdfs, setCompletedPdfs] = useState<
    { rider_name: string; url: string; filename: string; trip_id: string }[] | null
  >(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null);

  const issues = useMemo(() => validateStep(step, draft), [draft, step]);
  const done = useMemo(() => completedSteps(draft), [draft]);
  const stepIndex = STEPS.indexOf(step);

  function goNext() {
    if (Object.keys(issues).length > 0) {
      setShowErrors(true);
      toast.error(firstIssue(issues) ?? "Fill in the highlighted fields");
      return;
    }
    setShowErrors(false);
    if (step === "trip") {
      draft.legs.forEach((l) => {
        rememberAddress(l.pickup_address);
        rememberAddress(l.dropoff_address);
      });
    }
    const next = STEPS[Math.min(stepIndex + 1, STEPS.length - 1)];
    setStep(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setShowErrors(false);
    setStep(STEPS[Math.max(stepIndex - 1, 0)]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    if (!user) return;
    const allIssues = validateStep("review", draft);
    if (Object.keys(allIssues).length > 0) {
      setShowErrors(true);
      return toast.error(firstIssue(allIssues)!);
    }
    if (safetyIssue) return toast.error(safetyIssue);
    if (!online) return toast.error("You're offline — your draft is saved, try again on signal");
    setSubmitting(true);
    try {
      setSubmitStage("Creating trip…");
      const res = await submitGroup({ data: buildCreateTripPayload(draft) as any });

      const generated: { rider_name: string; url: string; filename: string; trip_id: string }[] = [];
      for (let i = 0; i < draft.rider_slots.length; i++) {
        const slot = draft.rider_slots[i];
        const newTripId = res.trip_ids[i];
        setSubmitStage(`Saving signature for ${slot.rider.full_name}…`);

        const png = await (await fetch(slot.signature_data_url!)).blob();
        const sigPath = `${user.id}/${newTripId}.png`;
        const sigUp = await supabase.storage
          .from("signatures")
          .upload(sigPath, png, { upsert: true, contentType: "image/png" });
        if (sigUp.error) throw sigUp.error;
        await attachSig({
          data: {
            trip_id: newTripId,
            signature_path: sigPath,
            signature_name: slot.signer_name,
          },
        });

        setSubmitStage(`Generating state form for ${slot.rider.full_name}…`);
        let riderOverride: DraftRider | undefined;
        try {
          const { identifier } = await getRiderIdentifierForPdf({
            data: { rider_id: slot.rider.id, trip_id: newTripId },
          });
          if (identifier) riderOverride = { ...slot.rider, medicaid_id: identifier };
        } catch {
          /* fall back to the rider row identifier */
        }
        const pdfBytes = await generateStateFormPdf(
          buildPdfArgs(draft, slot, {
            driverName: draft.driver_full_name || user.email || "",
            riderOverride,
          }) as any,
        );

        const pdfPath = `${user.id}/${newTripId}.pdf`;
        const pdfBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
        const pdfUp = await supabase.storage
          .from("state-pdfs")
          .upload(pdfPath, pdfBlob, { upsert: true, contentType: "application/pdf" });
        if (pdfUp.error) throw pdfUp.error;
        await attachPdf({ data: { trip_id: newTripId, state_pdf_path: pdfPath } });

        const { data: signed } = await supabase.storage
          .from("state-pdfs")
          .createSignedUrl(pdfPath, 60 * 15);
        if (signed?.signedUrl) {
          generated.push({
            rider_name: slot.rider.full_name,
            url: signed.signedUrl,
            trip_id: newTripId,
            filename: `nemt-${slot.rider.full_name.replace(/\s+/g, "_")}-${newTripId.slice(0, 8)}.pdf`,
          });
        }
      }

      if (typeof window !== "undefined") clearDraft(window.localStorage, storageKey);
      toast.success(
        draft.rider_slots.length === 1
          ? "Trip sent to billing"
          : `${draft.rider_slots.length} trips sent to billing`,
      );
      setCompletedPdfs(generated);
    } catch (e: any) {
      toast.error(e?.message ?? "Submission failed — your draft is still saved");
    } finally {
      setSubmitting(false);
      setSubmitStage("");
    }
  }

  async function buildPreview() {
    const slot = draft.rider_slots[0];
    if (!slot) return;
    try {
      const bytes = await generateStateFormPdf(
        buildPdfArgs(draft, slot, {
          driverName: draft.driver_full_name || user?.email || "",
        }) as any,
      );
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPdfPreview({ url, filename: "trip-preview.pdf" });
    } catch (e: any) {
      toast.error(e?.message ?? "Preview failed");
    }
  }

  async function downloadPdf(url: string, filename: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download PDF");
    }
  }

  if (!isDriver) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-muted-foreground">
        This flow is for drivers.
      </div>
    );
  }

  /* ------------------------------ success screen ------------------------- */
  if (completedPdfs) {
    return (
      <div className="driver-cta-content-pad mx-auto max-w-lg space-y-4 p-4">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <div className="text-lg font-semibold">Sent to billing</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed state trip log stored. Billing will review and submit it to the state portal.
            </p>
          </div>
          <div className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Status: pending billing review
          </div>
        </div>

        <div className="space-y-2">
          {completedPdfs.map((p) => (
            <div key={p.url} className="rounded-2xl border bg-surface p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{p.rider_name}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Trip #{p.trip_id.slice(0, 8).toUpperCase()}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setPdfPreview({ url: p.url, filename: p.filename })}
                >
                  View PDF
                </Button>
                <Button variant="outline" className="h-11" onClick={() => downloadPdf(p.url, p.filename)}>
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>

        <PdfPreviewDialog
          url={pdfPreview?.url ?? null}
          filename={pdfPreview?.filename ?? "trip.pdf"}
          onClose={() => setPdfPreview(null)}
        />

        <div className="driver-cta-bar z-20 border-t bg-background/95 px-3 pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-lg gap-2">
            <Button
              variant="outline"
              className="h-12 flex-1"
              onClick={() => {
                setCompletedPdfs(null);
                setDraft(createEmptyDraft());
                setStep("passenger");
              }}
            >
              New trip
            </Button>
            <Button className="h-12 flex-1" onClick={() => navigate({ to: "/driver" })}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const err = (key: string) => (showErrors ? issues[key] : undefined);

  return (
    <div className="driver-cta-content-pad mx-auto max-w-lg">
      {/* Sticky header + progress */}
      <div className="sticky top-0 z-20 border-b bg-background/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (stepIndex === 0 ? navigate({ to: "/driver" }) : goBack())}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              Step {stepIndex + 1} of {STEPS.length}
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
            <button
              key={s}
              type="button"
              onClick={() => i <= stepIndex && setStep(s)}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < stepIndex ? (done[s] ? "bg-emerald-500" : "bg-primary/50") : i === stepIndex ? "bg-primary" : "bg-muted"
              }`}
              aria-label={STEP_LABELS[s]}
            />
          ))}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {draftRestored && (
          <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
            <History className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-medium text-foreground">Draft restored</div>
              <div className="text-muted-foreground">We kept everything you had entered.</div>
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
                    draft.trip_kind === k.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "bg-surface"
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
                    <VerifyBadge
                      entry={verify[s.rider.id]}
                      onVerify={() => verifyRider(s.rider.id)}
                    />

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

        {/* --------------------------------- TRIP -------------------------- */}
        {step === "trip" && (
          <div className="space-y-4">
            {draft.legs.map((leg, i) => (
              <div key={leg.leg_index} className="space-y-3 rounded-2xl border bg-surface p-3">
                <div className="text-sm font-semibold">
                  {draft.legs.length > 1 ? (i === 0 ? "Outbound leg" : "Return leg") : "Trip details"}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date">
                    <Input
                      type="date"
                      className="h-12 text-base"
                      value={leg.leg_date}
                      onChange={(e) => patch((d) => updateLegIn(d, i, { leg_date: e.target.value }))}
                    />
                  </Field>
                  <Field label="Pickup time">
                    <div className="flex gap-2">
                      <Input
                        type="time"
                        className="h-12 text-base"
                        value={leg.pickup_time}
                        onChange={(e) => patch((d) => updateLegIn(d, i, { pickup_time: e.target.value }))}
                      />
                      <button
                        type="button"
                        aria-label="Set pickup time to now"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border"
                        onClick={() => patch((d) => updateLegIn(d, i, { pickup_time: nowHM() }))}
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                    </div>
                  </Field>
                </div>
                {err(`leg${i}.leg_date`) && <InlineError message={err(`leg${i}.leg_date`)!} />}

                <Field label="Pickup address">
                  <AddressAutocomplete
                    value={leg.pickup_address}
                    onChange={(v) => patch((d) => updateLegIn(d, i, { pickup_address: v }))}
                    onResolve={(p: any) =>
                      patch((d) => updateLegIn(d, i, { pickup_address: p.address ?? p.description ?? "" }))
                    }
                    placeholder="Where you picked them up"
                  />
                </Field>
                {i === 0 && (
                  <button
                    type="button"
                    onClick={() => useCurrentLocation(i)}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary"
                  >
                    {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                    Use my current location
                  </button>
                )}
                {err(`leg${i}.pickup_address`) && <InlineError message={err(`leg${i}.pickup_address`)!} />}

                <Field label="Drop-off address">
                  <AddressAutocomplete
                    value={leg.dropoff_address}
                    onChange={(v) => patch((d) => updateLegIn(d, i, { dropoff_address: v }))}
                    onResolve={(p: any) =>
                      patch((d) => updateLegIn(d, i, { dropoff_address: p.address ?? p.description ?? "" }))
                    }
                    placeholder="Where you dropped them off"
                  />
                </Field>
                {recentAddresses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {recentAddresses.slice(0, 4).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => patch((d) => updateLegIn(d, i, { dropoff_address: a }))}
                        className="max-w-full truncate rounded-full border px-2.5 py-1.5 text-xs text-muted-foreground active:bg-accent"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}
                {err(`leg${i}.dropoff_address`) && <InlineError message={err(`leg${i}.dropoff_address`)!} />}

                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Odometer readings — required for billing
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Pickup odometer *">
                      <OdometerInput
                        value={leg.pickup_odometer}
                        onChange={(v) => patch((d) => updateLegIn(d, i, { pickup_odometer: v }))}
                        onPhoto={(f) => handleOdometerPhoto(i, "pickup_odometer", f)}
                        detecting={!!detecting[`${i}-pickup_odometer`]}
                      />
                    </Field>
                    <Field label="Drop-off odometer *">
                      <OdometerInput
                        value={leg.dropoff_odometer}
                        onChange={(v) => patch((d) => updateLegIn(d, i, { dropoff_odometer: v }))}
                        onPhoto={(f) => handleOdometerPhoto(i, "dropoff_odometer", f)}
                        detecting={!!detecting[`${i}-dropoff_odometer`]}
                      />
                    </Field>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {legMiles(leg) === null
                      ? "Type both readings (or snap a photo). Drop-off must be ≥ pickup."
                      : `Billable mileage: ${legMiles(leg)!.toFixed(1)} mi`}
                  </div>
                </div>
                {(err(`leg${i}.pickup_odometer`) || err(`leg${i}.dropoff_odometer`)) && (
                  <InlineError
                    message={(err(`leg${i}.pickup_odometer`) || err(`leg${i}.dropoff_odometer`))!}
                  />
                )}


                <Field label="Drop-off time">
                  <div className="flex gap-2">
                    <Input
                      type="time"
                      className="h-12 text-base"
                      value={leg.dropoff_time}
                      onChange={(e) => patch((d) => updateLegIn(d, i, { dropoff_time: e.target.value }))}
                    />
                    <button
                      type="button"
                      aria-label="Set drop-off time to now"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border"
                      onClick={() => patch((d) => updateLegIn(d, i, { dropoff_time: nowHM() }))}
                    >
                      <Clock className="h-4 w-4" />
                    </button>
                  </div>
                </Field>
              </div>
            ))}
          </div>
        )}

        {/* -------------------------------- DETAILS ------------------------ */}
        {step === "details" && (
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

              {rateCheck && !rateCheck.ok && (
                <div className="flex gap-2 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>No billing rate for this vehicle type (missing: {rateCheck.missing.join(", ")}).</span>
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

        {/* ------------------------------- SIGNATURE ----------------------- */}
        {step === "sign" && (
          <div className="space-y-4">
            {draft.rider_slots.map((s) => (
              <div key={s.rider.id} className="space-y-3 rounded-2xl border bg-surface p-3">
                <div>
                  <div className="text-sm font-semibold">{s.rider.full_name}</div>
                  <p className="text-xs text-muted-foreground">
                    Hand the phone to the passenger and ask them to sign in the box.
                  </p>
                </div>
                <SignaturePad
                  onChange={(url) => patch((d) => updateSlotIn(d, s.rider.id, { signature_data_url: url }))}
                />
                <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
                  <span className="text-sm">Signed by escort instead</span>
                  <Switch
                    checked={s.signed_by_escort}
                    onCheckedChange={(v) =>
                      patch((d) =>
                        updateSlotIn(d, s.rider.id, {
                          signed_by_escort: v,
                          signer_name: v ? d.escort_name || s.signer_name : s.rider.full_name,
                        }),
                      )
                    }
                  />
                </div>
                <Field label="Signed by">
                  <Input
                    className="h-12 text-base"
                    value={s.signer_name}
                    onChange={(e) => patch((d) => updateSlotIn(d, s.rider.id, { signer_name: e.target.value }))}
                  />
                </Field>
                <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
                  <span className="text-sm">I verified their identity</span>
                  <Switch
                    checked={s.identity_verified}
                    onCheckedChange={(v) => patch((d) => updateSlotIn(d, s.rider.id, { identity_verified: v }))}
                  />
                </div>
                {(err(`sig.${s.rider.id}`) || err(`name.${s.rider.id}`)) && (
                  <InlineError message={(err(`sig.${s.rider.id}`) || err(`name.${s.rider.id}`))!} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* -------------------------------- REVIEW ------------------------- */}
        {step === "review" && (
          <div className="space-y-3">
            <SummaryCard title="Passengers" onEdit={() => setStep("passenger")}>
              {draft.rider_slots.map((s) => (
                <div key={s.rider.id} className="space-y-0.5">
                  <Row label={s.rider.full_name} value={s.rider.medicaid_id} />
                  <Row label="Medicaid check" value={verificationLabel(verify[s.rider.id])} />
                </div>
              ))}

              <Row label="Trip type" value={TRIP_KINDS.find((k) => k.value === draft.trip_kind)?.label ?? ""} />
            </SummaryCard>

            <SummaryCard title="Trip" onEdit={() => setStep("trip")}>
              {draft.legs.map((l, i) => (
                <div key={l.leg_index} className="space-y-1">
                  {draft.legs.length > 1 && (
                    <div className="text-xs font-semibold">{i === 0 ? "Outbound" : "Return"}</div>
                  )}
                  <Row label="Date" value={`${l.leg_date} ${l.pickup_time}`} />
                  <Row label="From" value={l.pickup_address} />
                  <Row label="To" value={l.dropoff_address} />
                  <Row label="Pickup odometer" value={l.pickup_odometer || "— missing"} />
                  <Row label="Drop-off odometer" value={l.dropoff_odometer || "— missing"} />
                  <Row
                    label="Miles"
                    value={legMiles(l) === null ? "Check odometer readings" : `${legMiles(l)!.toFixed(1)} mi`}
                  />

                </div>
              ))}
            </SummaryCard>

            <SummaryCard title="Vehicle" onEdit={() => setStep("details")}>
              <Row
                label="Type"
                value={VEHICLE_TYPES.find((v) => v.value === draft.vehicle_type)?.label ?? ""}
              />
              <Row label="Plate" value={draft.plate} />
              {draft.escort_name && <Row label="Escort" value={draft.escort_name} />}
            </SummaryCard>

            <SummaryCard title="Signature" onEdit={() => setStep("sign")}>
              {draft.rider_slots.map((s) => (
                <div key={s.rider.id} className="flex items-center gap-2 text-xs">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="truncate">
                    Signed by {s.signer_name}
                    {s.signed_by_escort ? " (escort)" : ""}
                  </span>
                </div>
              ))}
            </SummaryCard>

            <Button variant="outline" className="h-12 w-full" onClick={buildPreview}>
              <FileText className="mr-2 h-4 w-4" /> Preview state form
            </Button>

            {safetyIssue && (
              <div className="flex gap-2 rounded-2xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{safetyIssue}</span>
              </div>
            )}

            {verifyWarnings.length > 0 && (
              <div className="space-y-1 rounded-2xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                {verifyWarnings.map((w) => (
                  <div key={w} className="flex gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
                <p className="pl-6 text-[11px] opacity-80">
                  You can still submit — billing staff will review this trip.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky primary CTA */}
      <div className="driver-cta-bar z-20 border-t bg-background/95 px-3 pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {submitStage && (
            <div className="mb-2 text-center text-xs text-muted-foreground">{submitStage}</div>
          )}
          {step === "review" ? (
            <Button className="h-14 w-full text-base" onClick={handleSubmit} disabled={submitting || !online}>
              {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {submitting ? "Sending…" : "Submit to billing"}
            </Button>
          ) : (
            <Button className="h-14 w-full text-base" onClick={goNext}>
              Continue
              <ChevronRight className="ml-1 h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      <PdfPreviewDialog
        url={pdfPreview?.url ?? null}
        filename={pdfPreview?.filename ?? "trip.pdf"}
        onClose={() => setPdfPreview(null)}
      />
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
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ${tone}`}
        >
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
          Portal check runs in the background (1–3 min) — keep filling out the trip.
        </p>
      )}
      {!running && entry?.result?.message && (
        <p className="text-[11px] text-muted-foreground">{entry.result.message}</p>
      )}
      {label !== "Verified" && !running && (
        <p className="text-[11px] text-muted-foreground">
          Optional — you can submit without checking; billing staff will review.
        </p>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right font-medium">{value}</span>
    </div>
  );
}

function SummaryCard({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-primary">
          Edit
        </button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function OdometerInput({
  value,
  onChange,
  onPhoto,
  detecting,
}: {
  value: string;
  onChange: (value: string) => void;
  onPhoto: (file: File | null) => void;
  detecting: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        inputMode="numeric"
        className="h-12 text-base"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="123456"
      />
      <label className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background text-muted-foreground active:bg-accent">
        {detecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        <span className="sr-only">Take odometer photo</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={detecting}
          onChange={(e) => {
            onPhoto(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
}
