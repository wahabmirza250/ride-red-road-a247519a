import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
import { SignaturePad } from "@/components/driver/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, UserPlus, X, Loader2, Check, Camera } from "lucide-react";
import {
  createNemtTripGroup,
  attachRiderSignature,
  attachStatePdf,
  getMyDriverDefaults,
  getAssignedTripForNemt,
  detectOdometerFromImage,
} from "@/lib/nemtTrip.functions";
import { generateStateFormPdf } from "@/lib/medicaidPdf";

export const Route = createFileRoute("/driver/trip/new")({
  validateSearch: (search) => ({
    tripId: typeof search.tripId === "string" ? search.tripId : undefined,
  }),
  component: NewNemtTripWizard,
});

type Rider = {
  id: string;
  full_name: string;
  medicaid_id: string;
  dob: string | null;
  phone: string | null;
  address: string | null;
};

type LegForm = {
  leg_index: 1 | 2;
  leg_date: string;
  pickup_time: string;
  pickup_odometer: string;
  pickup_address: string;
  dropoff_time: string;
  dropoff_odometer: string;
  dropoff_address: string;
};

type RiderSlot = {
  rider: Rider;
  identity_verified: boolean;
  signed_by_escort: boolean;
  signature_data_url: string | null;
  signer_name: string;
};

type AssignedTrip = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_time: string;
  status: string;
};

const VEHICLE_TYPES = [
  { value: "ground_ambulance", label: "Ground Ambulance" },
  { value: "wheelchair_van", label: "Wheelchair Van" },
  { value: "stretcher_van", label: "Stretcher Van" },
  { value: "taxi", label: "Taxi" },
  { value: "ambulatory", label: "Mobility / Ambulatory" },
];

const today = () => new Date().toISOString().slice(0, 10);
const nowHM = () => new Date().toTimeString().slice(0, 5);

function emptyLeg(index: 1 | 2): LegForm {
  return {
    leg_index: index,
    leg_date: today(),
    pickup_time: index === 1 ? nowHM() : "",
    pickup_odometer: "",
    pickup_address: "",
    dropoff_time: "",
    dropoff_odometer: "",
    dropoff_address: "",
  };
}

function NewNemtTripWizard() {
  const { tripId } = Route.useSearch();
  const { user, isDriver } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("vehicle");
  const [assignedTrip, setAssignedTrip] = useState<AssignedTrip | null>(null);
  const [assignedPassengerName, setAssignedPassengerName] = useState<string | null>(null);

  // Vehicle / trip meta
  const [tripKind, setTripKind] = useState<"one_way" | "round_trip" | "group_tour">("one_way");
  const [vehicleType, setVehicleType] = useState<string>("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [escortName, setEscortName] = useState("");
  const [driverFullName, setDriverFullName] = useState("");

  // Load driver defaults once
  const loadDefaults = useServerFn(getMyDriverDefaults);
  useEffect(() => {
    loadDefaults()
      .then((d: any) => {
        if (!d) return;
        if (d.default_vehicle_type) setVehicleType(d.default_vehicle_type);
        if (d.default_plate) setPlate(d.default_plate);
        if (d.default_vin) setVin(d.default_vin);
        if (d.driver_full_name) setDriverFullName(d.driver_full_name);
      })
      .catch(() => {});
  }, [loadDefaults]);

  // Riders
  const [riderSlots, setRiderSlots] = useState<RiderSlot[]>([]);
  const [riderQuery, setRiderQuery] = useState("");
  const [riderResults, setRiderResults] = useState<Rider[]>([]);
  const [addingRider, setAddingRider] = useState(false);
  const [newRider, setNewRider] = useState({ full_name: "", medicaid_id: "", dob: "", phone: "", last_4_ssn: "" });
  const loadAssignedTrip = useServerFn(getAssignedTripForNemt);

  useEffect(() => {
    let cancelled = false;
    if (!riderQuery.trim()) {
      setRiderResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const raw = riderQuery.trim();
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
      const fromRiders = (ridersRes.data as Rider[]) ?? [];
      const fromPassengers: (Rider & { __source: "passenger"; last_4_ssn?: string | null })[] =
        ((passengersRes.data as any[]) ?? []).map((p) => ({
          id: `passenger:${p.id}`,
          full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unnamed passenger",
          medicaid_id: p.medicaid_id ?? "",
          dob: p.date_of_birth ?? null,
          phone: p.phone ?? null,
          address: null,
          last_4_ssn: p.ssn_last4 ?? null,
          __source: "passenger" as const,
        }));
      // De-dupe passengers already present in riders (by medicaid_id)
      const knownMedicaid = new Set(fromRiders.map((r) => r.medicaid_id).filter(Boolean));
      const merged = [
        ...fromRiders,
        ...fromPassengers.filter((p) => !p.medicaid_id || !knownMedicaid.has(p.medicaid_id)),
      ].slice(0, 8);
      if (!cancelled) setRiderResults(merged);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [riderQuery]);

  async function selectSearchResult(r: Rider & { __source?: "passenger"; last_4_ssn?: string | null }) {
    // Passengers-table hits aren't real rider rows yet — materialize one.
    if (r.__source === "passenger") {
      const medicaid = r.medicaid_id?.trim();
      if (medicaid) {
        const { data: existing } = await supabase
          .from("riders")
          .select("*")
          .eq("medicaid_id", medicaid)
          .maybeSingle();
        if (existing) {
          addRiderSlot(existing as Rider);
          return;
        }
      }
      const { data, error } = await supabase
        .from("riders")
        .insert({
          full_name: r.full_name,
          medicaid_id: medicaid || `SSN-${r.last_4_ssn ?? "0000"}`,
          dob: r.dob || null,
          phone: r.phone || null,
          last_4_ssn: medicaid ? null : r.last_4_ssn ?? null,
        })
        .select()
        .single();
      if (error) return toast.error(error.message);
      addRiderSlot(data as Rider);
      return;
    }
    addRiderSlot(r);
  }

  function addRiderSlot(r: Rider) {
    if (riderSlots.some((s) => s.rider.id === r.id)) return;
    if (tripKind !== "group_tour" && riderSlots.length >= 1) {
      toast.info("Switch to Group Tour to add more than one passenger");
      return;
    }
    setRiderSlots((prev) => [
      ...prev,
      {
        rider: r,
        identity_verified: true,
        signed_by_escort: false,
        signature_data_url: null,
        signer_name: r.full_name,
      },
    ]);
    setRiderQuery("");
    setRiderResults([]);
  }

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    loadAssignedTrip({ data: { trip_id: tripId } })
      .then((prefill) => {
        if (cancelled) return;
        setAssignedTrip(prefill.trip as AssignedTrip);
        setAssignedPassengerName(prefill.passenger?.full_name ?? null);

        const scheduled = prefill.trip.scheduled_pickup_time
          ? new Date(prefill.trip.scheduled_pickup_time)
          : new Date();
        const isValidDate = !Number.isNaN(scheduled.getTime());
        const baseDate = isValidDate ? scheduled.toISOString().slice(0, 10) : today();
        const baseTime = isValidDate ? scheduled.toTimeString().slice(0, 5) : nowHM();

        setLegs((prev) => {
          const first = prev[0] ?? emptyLeg(1);
          const nextFirst: LegForm = {
            ...first,
            leg_date: first.leg_date || baseDate,
            pickup_time: first.pickup_time || baseTime,
            pickup_address: first.pickup_address || prefill.trip.pickup_address,
            dropoff_address: first.dropoff_address || prefill.trip.dropoff_address,
          };
          if (tripKind === "round_trip") {
            const second = prev[1] ?? emptyLeg(2);
            return [
              nextFirst,
              {
                ...second,
                leg_date: second.leg_date || baseDate,
                pickup_address: second.pickup_address || prefill.trip.dropoff_address,
                dropoff_address: second.dropoff_address || prefill.trip.pickup_address,
              },
            ];
          }
          return [nextFirst];
        });

        if (prefill.rider) {
          const rider = prefill.rider as Rider;
          setRiderSlots((prev) => {
            if (prev.some((slot) => slot.rider.id === rider.id)) return prev;
            if (tripKind !== "group_tour" && prev.length >= 1) return prev;
            return [
              ...prev,
              {
                rider,
                identity_verified: true,
                signed_by_escort: false,
                signature_data_url: null,
                signer_name: rider.full_name,
              },
            ];
          });
        } else if (prefill.passenger) {
          setRiderQuery(prefill.passenger.full_name ?? "");
          toast.info("Assigned address loaded. Select or create the passenger to continue.");
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load assigned trip"));
    return () => {
      cancelled = true;
    };
  }, [loadAssignedTrip, tripId, tripKind]);

  async function createNewRider() {
    if (!newRider.full_name.trim()) return toast.error("Full name required");
    const hasMedicaid = !!newRider.medicaid_id.trim();
    const hasSsn = /^\d{4}$/.test(newRider.last_4_ssn);
    if (!hasMedicaid && !hasSsn) {
      return toast.error("Enter a Medicaid ID or last 4 digits of SSN");
    }
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
    if (error) return toast.error(error.message);
    addRiderSlot(data as Rider);
    setAddingRider(false);
    setNewRider({ full_name: "", medicaid_id: "", dob: "", phone: "", last_4_ssn: "" });
  }

  // Legs
  const [legs, setLegs] = useState<LegForm[]>([emptyLeg(1)]);
  useEffect(() => {
    if (tripKind === "round_trip") {
      setLegs((prev) => {
        if (prev.length === 2) return prev;
        const first = prev[0] ?? emptyLeg(1);
        const second = emptyLeg(2);
        return [
          first,
          {
            ...second,
            leg_date: first.leg_date || second.leg_date,
            pickup_address: assignedTrip?.dropoff_address || first.dropoff_address,
            dropoff_address: assignedTrip?.pickup_address || first.pickup_address,
          },
        ];
      });
    } else {
      setLegs((prev) => (prev.length === 1 ? prev : [prev[0]]));
    }
  }, [assignedTrip, tripKind]);

  const updateLeg = (idx: number, patch: Partial<LegForm>) =>
    setLegs((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const detectOdometer = useServerFn(detectOdometerFromImage);
  const [detectingOdometer, setDetectingOdometer] = useState<Record<string, boolean>>({});

  async function handleOdometerPhoto(
    legIndex: number,
    field: "pickup_odometer" | "dropoff_odometer",
    file: File | null,
  ) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an odometer photo");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error("Photo is too large. Use a smaller image.");
      return;
    }

    const key = `${legIndex}-${field}`;
    setDetectingOdometer((prev) => ({ ...prev, [key]: true }));
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const result = await detectOdometer({ data: { image_data_url: imageDataUrl } });
      if (!result.odometer) {
        toast.error("Could not read the odometer. Type the number manually.");
        return;
      }
      updateLeg(legIndex, { [field]: result.odometer });
      toast.success(`Odometer detected: ${result.odometer}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not detect odometer");
    } finally {
      setDetectingOdometer((prev) => ({ ...prev, [key]: false }));
    }
  }

  function saveSignature(riderId: string, url: string | null) {
    setRiderSlots((prev) =>
      prev.map((s) => (s.rider.id === riderId ? { ...s, signature_data_url: url } : s)),
    );
  }

  // Submit
  const submitGroup = useServerFn(createNemtTripGroup);
  const attachSig = useServerFn(attachRiderSignature);
  const attachPdf = useServerFn(attachStatePdf);
  const [submitting, setSubmitting] = useState(false);
  const [completedPdfs, setCompletedPdfs] = useState<
    { rider_name: string; url: string; filename: string }[] | null
  >(null);

  const vehicleIssue = useMemo(() => {
    if (!vehicleType) return "Select vehicle type";
    if (!plate.trim()) return "Enter license plate";
    return null;
  }, [plate, vehicleType]);

  const riderIssue = useMemo(() => {
    if (riderSlots.length === 0) return "Add at least one passenger";
    return null;
  }, [riderSlots.length]);

  const legsIssue = useMemo(() => {
    for (const l of legs) {
      const legName = l.leg_index === 1 ? "outbound leg" : "return leg";
      if (!l.leg_date) return `Enter date for ${legName}`;
      if (!l.pickup_address.trim()) return `Enter pickup address for ${legName}`;
      if (!l.dropoff_address.trim()) return `Enter drop-off address for ${legName}`;
      if (l.pickup_odometer === "") return `Enter pickup odometer for ${legName}`;
      if (l.dropoff_odometer === "") return `Enter drop-off odometer for ${legName}`;
      if (!Number.isFinite(Number(l.pickup_odometer)) || Number(l.pickup_odometer) < 0) {
        return `Check pickup odometer for ${legName}`;
      }
      if (!Number.isFinite(Number(l.dropoff_odometer)) || Number(l.dropoff_odometer) < 0) {
        return `Check drop-off odometer for ${legName}`;
      }
    }
    return null;
  }, [legs]);

  const signatureIssue = useMemo(() => {
    const missingSignature = riderSlots.find((s) => !s.signature_data_url);
    if (missingSignature) return `${missingSignature.rider.full_name} still needs a signature`;
    const missingName = riderSlots.find((s) => !s.signer_name.trim());
    if (missingName) return `Enter signer name for ${missingName.rider.full_name}`;
    return null;
  }, [riderSlots]);

  function goNext(nextTab: string, issue: string | null) {
    if (issue) {
      toast.error(issue);
      return;
    }
    setTab(nextTab);
  }

  async function handleSubmit() {
    if (!user) return;
    const issue = vehicleIssue || riderIssue || legsIssue || signatureIssue;
    if (issue) return toast.error(issue);
    setSubmitting(true);
    try {
      const res = await submitGroup({
        data: {
          trip_kind: tripKind,
          vehicle_type: vehicleType as any,
          vehicle_plate: plate,
          vehicle_vin: vin || null,
          escort_name: escortName || null,
          riders: riderSlots.map((s) => ({
            rider_id: s.rider.id,
            identity_verified: s.identity_verified,
            signed_by_escort: s.signed_by_escort,
          })),
          legs: legs.map((l) => ({
            leg_index: l.leg_index,
            leg_date: l.leg_date,
            pickup_time: l.pickup_time || null,
            pickup_odometer: Number(l.pickup_odometer),
            pickup_address: l.pickup_address,
            dropoff_time: l.dropoff_time || null,
            dropoff_odometer: Number(l.dropoff_odometer),
            dropoff_address: l.dropoff_address,
          })),
        },
      });

      // For each rider: upload signature, generate the filled state PDF,
      // upload it to state-pdfs, and attach both to the trip row.
      const generated: { rider_name: string; url: string; filename: string }[] = [];
      const legsPayload = legs.map((l) => ({
        leg_index: l.leg_index,
        leg_date: l.leg_date,
        pickup_time: l.pickup_time || null,
        pickup_odometer: Number(l.pickup_odometer),
        pickup_address: l.pickup_address,
        dropoff_time: l.dropoff_time || null,
        dropoff_odometer: Number(l.dropoff_odometer),
        dropoff_address: l.dropoff_address,
      }));

      for (let i = 0; i < riderSlots.length; i++) {
        const slot = riderSlots[i];
        const tripId = res.trip_ids[i];

        // 1. Signature upload
        const png = await (await fetch(slot.signature_data_url!)).blob();
        const sigPath = `${user.id}/${tripId}.png`;
        const sigUp = await supabase.storage
          .from("signatures")
          .upload(sigPath, png, { upsert: true, contentType: "image/png" });
        if (sigUp.error) throw sigUp.error;
        await attachSig({
          data: {
            trip_id: tripId,
            signature_path: sigPath,
            signature_name: slot.signer_name,
          },
        });

        // 2. Generate the filled Colorado NEMT Trip Log PDF
        const pdfBytes = await generateStateFormPdf({
          rider: slot.rider,
          driverName: driverFullName || user.email || "",
          vehiclePlate: plate,
          vehicleVin: vin || null,
          vehicleType,
          escortName: escortName || null,
          identityVerified: slot.identity_verified,
          tripKind,
          legs: legsPayload,
          signatureName: slot.signer_name,
          signatureUrl: slot.signature_data_url,
          signedByEscort: slot.signed_by_escort,
        });

        // 3. Upload PDF to state-pdfs bucket
        const pdfPath = `${user.id}/${tripId}.pdf`;
        const pdfBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
        const pdfUp = await supabase.storage
          .from("state-pdfs")
          .upload(pdfPath, pdfBlob, { upsert: true, contentType: "application/pdf" });
        if (pdfUp.error) throw pdfUp.error;
        await attachPdf({ data: { trip_id: tripId, state_pdf_path: pdfPath } });

        // 4. Signed URL for driver confirmation view
        const { data: signed } = await supabase.storage
          .from("state-pdfs")
          .createSignedUrl(pdfPath, 60 * 15);
        if (signed?.signedUrl) {
          generated.push({
            rider_name: slot.rider.full_name,
            url: signed.signedUrl,
            filename: `nemt-${slot.rider.full_name.replace(/\s+/g, "_")}-${tripId.slice(0, 8)}.pdf`,
          });
        }
      }

      toast.success(
        riderSlots.length === 1
          ? "Trip submitted for review"
          : `${riderSlots.length} passenger forms submitted for review`,
      );
      setCompletedPdfs(generated);
    } catch (e: any) {
      toast.error(e.message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Live preview PDF for first rider
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  async function buildPreview(slot: RiderSlot) {
    try {
      const bytes = await generateStateFormPdf({
        rider: slot.rider,
        driverName: user?.email ?? "",
        vehiclePlate: plate,
        vehicleVin: vin,
        vehicleType,
        escortName,
        identityVerified: slot.identity_verified,
        tripKind,
        legs: legs.map((l) => ({
          leg_index: l.leg_index,
          leg_date: l.leg_date,
          pickup_time: l.pickup_time || null,
          pickup_odometer: Number(l.pickup_odometer || 0),
          pickup_address: l.pickup_address,
          dropoff_time: l.dropoff_time || null,
          dropoff_odometer: Number(l.dropoff_odometer || 0),
          dropoff_address: l.dropoff_address,
        })),
        signatureName: slot.signer_name,
        signatureUrl: slot.signature_data_url,
        signedByEscort: slot.signed_by_escort,
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      toast.error(e.message ?? "Preview failed");
    }
  }

  if (!isDriver) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-muted-foreground">
        This wizard is for drivers.
      </div>
    );
  }

  async function fetchPdfBlob(url: string): Promise<string> {
    // Fetch as blob so ad-blockers that filter direct storage host URLs
    // (ERR_BLOCKED_BY_CLIENT on *.supabase.co) don't intercept the navigation.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  }

  async function openPdfInNewTab(url: string, filename: string) {
    // Open the tab synchronously so it isn't treated as a popup, then
    // point it at the blob URL once the fetch resolves.
    const win = window.open("", "_blank");
    try {
      const blobUrl = await fetchPdfBlob(url);
      if (win) {
        win.location.href = blobUrl;
      } else {
        // Popup blocked — fall back to a direct download.
        downloadFromBlobUrl(blobUrl, filename);
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not open PDF");
    }
  }

  async function downloadPdf(url: string, filename: string) {
    try {
      const blobUrl = await fetchPdfBlob(url);
      downloadFromBlobUrl(blobUrl, filename);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download PDF");
    }
  }

  function downloadFromBlobUrl(blobUrl: string, filename: string) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (completedPdfs) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
        <PageHeader
          title="Trip submitted"
          description="Your filled state trip log is stored and queued for billing review."
        />
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" /> One PDF per passenger generated
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Billing will review and then auto-submit to the Colorado provider portal.
          </p>
        </div>

        <div className="space-y-2">
          {completedPdfs.length === 0 && (
            <div className="text-sm text-muted-foreground">No PDFs generated.</div>
          )}
          {completedPdfs.map((p) => (
            <div
              key={p.url}
              className="flex items-center justify-between gap-3 rounded-xl border bg-surface p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.rider_name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.filename}</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openPdfInNewTab(p.url, p.filename)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  View PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadPdf(p.url, p.filename)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/driver/history" })}>
            History
          </Button>
          <Button onClick={() => navigate({ to: "/driver" })}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <PageHeader
        title="Complete NEMT trip"
        description="Digital version of the Colorado NEMT Trip Report — one form per passenger is generated automatically."
      />

      {assignedTrip && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          <div className="font-semibold text-foreground">Assigned ride loaded</div>
          <div className="mt-1">Pickup and drop-off match the admin assignment{assignedPassengerName ? ` for ${assignedPassengerName}` : ""}.</div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5 text-xs">
          <TabsTrigger value="vehicle">1. Vehicle</TabsTrigger>
          <TabsTrigger value="riders">2. Passengers</TabsTrigger>
          <TabsTrigger value="legs">3. Legs</TabsTrigger>
          <TabsTrigger value="sign">4. Signatures</TabsTrigger>
          <TabsTrigger value="review">5. Review</TabsTrigger>
        </TabsList>

        {/* ---------- STEP 1 ---------- */}
        <TabsContent value="vehicle" className="space-y-4 pt-4">
          <Field label="Trip type">
            <Select value={tripKind} onValueChange={(v) => setTripKind(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="one_way">One way</SelectItem>
                <SelectItem value="round_trip">Round trip</SelectItem>
                <SelectItem value="group_tour">Group tour (multiple passengers)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vehicle type">
            <Select value={vehicleType} onValueChange={setVehicleType}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="License plate">
            <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC-1234" />
          </Field>
          <Field label="VIN (optional)">
            <Input value={vin} onChange={(e) => setVin(e.target.value)} />
          </Field>
          <Field label="Escort name (optional)">
            <Input value={escortName} onChange={(e) => setEscortName(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button onClick={() => goNext("riders", vehicleIssue)}>Next</Button>
          </div>
        </TabsContent>

        {/* ---------- STEP 2 ---------- */}
        <TabsContent value="riders" className="space-y-4 pt-4">
          <div className="rounded-xl border p-3">
            <Label className="text-sm font-semibold">Add passenger</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search passenger by name, Medicaid ID or phone"
                  value={riderQuery}
                  onChange={(e) => setRiderQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={() => setAddingRider((v) => !v)}>
                <UserPlus className="mr-1 h-4 w-4" /> New
              </Button>
            </div>
            {riderResults.length > 0 && (
              <div className="mt-2 rounded-lg border">
                {riderResults.map((r) => {
                  const source = (r as Rider & { __source?: "passenger" }).__source;
                  return (
                    <button
                      key={r.id}
                      onClick={() => selectSearchResult(r as Rider & { __source?: "passenger"; last_4_ssn?: string | null })}
                      className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
                    >
                      <span className="flex items-center gap-2">
                        {r.full_name}
                        {source === "passenger" && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            From passengers
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.medicaid_id || "—"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {addingRider && (
              <div className="mt-3 space-y-2">
                <Input placeholder="Full legal name" value={newRider.full_name}
                  onChange={(e) => setNewRider({ ...newRider, full_name: e.target.value })} />
                <Input placeholder="Health First Colorado ID (preferred)" value={newRider.medicaid_id}
                  onChange={(e) => setNewRider({ ...newRider, medicaid_id: e.target.value })} />
                {!newRider.medicaid_id.trim() && (
                  <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                    <div className="mb-2 font-medium text-amber-700 dark:text-amber-400">
                      No Medicaid ID? Enter last 4 of SSN (DOB optional).
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="date" placeholder="DOB" value={newRider.dob}
                        onChange={(e) => setNewRider({ ...newRider, dob: e.target.value })} />
                      <Input
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Last 4 SSN"
                        value={newRider.last_4_ssn}
                        onChange={(e) =>
                          setNewRider({ ...newRider, last_4_ssn: e.target.value.replace(/\D/g, "").slice(0, 4) })
                        }
                      />
                    </div>
                  </div>
                )}
                {newRider.medicaid_id.trim() && (
                  <Input type="date" placeholder="DOB" value={newRider.dob}
                    onChange={(e) => setNewRider({ ...newRider, dob: e.target.value })} />
                )}
                <Input placeholder="Phone" value={newRider.phone}
                  onChange={(e) => setNewRider({ ...newRider, phone: e.target.value })} />
                <Button size="sm" onClick={createNewRider}>Save passenger</Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {riderSlots.map((s) => (
              <div key={s.rider.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm">{s.rider.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.rider.medicaid_id}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost"
                    onClick={() => setRiderSlots((p) => p.filter((x) => x.rider.id !== s.rider.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={s.identity_verified}
                      onCheckedChange={(v) =>
                        setRiderSlots((p) => p.map((x) =>
                          x.rider.id === s.rider.id ? { ...x, identity_verified: !!v } : x))}
                    />
                    Identity verified
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={s.signed_by_escort}
                      onCheckedChange={(v) =>
                        setRiderSlots((p) => p.map((x) =>
                          x.rider.id === s.rider.id ? { ...x, signed_by_escort: !!v } : x))}
                    />
                    Escort will sign
                  </label>
                </div>
              </div>
            ))}
            {riderSlots.length === 0 && (
              <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                Add at least one passenger.
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("vehicle")}>Back</Button>
            <Button onClick={() => goNext("legs", riderIssue)}>Next</Button>
          </div>
        </TabsContent>

        {/* ---------- STEP 3 ---------- */}
        <TabsContent value="legs" className="space-y-4 pt-4">
          {legs.map((l, i) => (
            <div key={l.leg_index} className="rounded-xl border p-3 space-y-3">
              <div className="text-sm font-semibold">
                Leg {l.leg_index} {l.leg_index === 1 ? "(Outbound)" : "(Return)"}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date">
                  <Input type="date" value={l.leg_date}
                    onChange={(e) => updateLeg(i, { leg_date: e.target.value })} />
                </Field>
                <div />
                <Field label="Pickup time">
                  <Input type="time" value={l.pickup_time}
                    onChange={(e) => updateLeg(i, { pickup_time: e.target.value })} />
                </Field>
                <Field label="Pickup odometer">
                  <OdometerInput
                    value={l.pickup_odometer}
                    onChange={(value) => updateLeg(i, { pickup_odometer: value })}
                    detecting={!!detectingOdometer[`${i}-pickup_odometer`]}
                    onPhoto={(file) => handleOdometerPhoto(i, "pickup_odometer", file)}
                  />
                </Field>
              </div>
              <Field label="Pickup address">
                <Textarea rows={2} value={l.pickup_address}
                  onChange={(e) => updateLeg(i, { pickup_address: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Drop-off time">
                  <Input type="time" value={l.dropoff_time}
                    onChange={(e) => updateLeg(i, { dropoff_time: e.target.value })} />
                </Field>
                <Field label="Drop-off odometer">
                  <OdometerInput
                    value={l.dropoff_odometer}
                    onChange={(value) => updateLeg(i, { dropoff_odometer: value })}
                    detecting={!!detectingOdometer[`${i}-dropoff_odometer`]}
                    onPhoto={(file) => handleOdometerPhoto(i, "dropoff_odometer", file)}
                  />
                </Field>
              </div>
              <Field label="Drop-off address">
                <Textarea rows={2} value={l.dropoff_address}
                  onChange={(e) => updateLeg(i, { dropoff_address: e.target.value })} />
              </Field>
            </div>
          ))}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("riders")}>Back</Button>
            <Button onClick={() => goNext("sign", legsIssue)}>Next</Button>
          </div>
        </TabsContent>

        {/* ---------- STEP 4 ---------- */}
        <TabsContent value="sign" className="space-y-4 pt-4">
          {riderSlots.map((s) => (
            <div key={s.rider.id} className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{s.rider.full_name}</div>
                  <div className="text-xs text-muted-foreground">{s.rider.medicaid_id}</div>
                </div>
                {s.signature_data_url && <Check className="h-5 w-5 text-primary" />}
              </div>
              <Input placeholder="Printed signer name" value={s.signer_name}
                onChange={(e) => setRiderSlots((p) => p.map((x) =>
                  x.rider.id === s.rider.id ? { ...x, signer_name: e.target.value } : x))} />
              <SignaturePad onChange={(url) => saveSignature(s.rider.id, url)} />
            </div>
          ))}
          {signatureIssue && (
            <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              {signatureIssue}
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("legs")}>Back</Button>
            <Button onClick={() => goNext("review", signatureIssue)}>Next</Button>
          </div>
        </TabsContent>

        {/* ---------- STEP 5 ---------- */}
        <TabsContent value="review" className="space-y-4 pt-4">
          <div className="rounded-xl border p-3 text-sm">
            <div className="font-semibold">Summary</div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>Trip: <b>{tripKind.replace("_", " ")}</b> · Vehicle: <b>{vehicleType}</b> · Plate: <b>{plate}</b></li>
              <li>Riders: {riderSlots.length}</li>
              <li>Legs: {legs.length}</li>
            </ul>
          </div>
          <div className="space-y-2">
            {riderSlots.map((s) => (
              <div key={s.rider.id} className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <div className="text-sm font-semibold">{s.rider.full_name}</div>
                  <div className="text-xs text-muted-foreground">{s.rider.medicaid_id}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => buildPreview(s)}>
                  Preview PDF
                </Button>
              </div>
            ))}
          </div>
          {previewUrl && (
            <iframe src={previewUrl} className="h-[70vh] w-full rounded-xl border" title="preview" />
          )}
          {(vehicleIssue || riderIssue || legsIssue || signatureIssue) && (
            <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              {vehicleIssue || riderIssue || legsIssue || signatureIssue}
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("sign")}>Back</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Submit for billing review
            </Button>
          </div>
        </TabsContent>
      </Tabs>
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="123456"
      />
      <label className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground">
        {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
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
