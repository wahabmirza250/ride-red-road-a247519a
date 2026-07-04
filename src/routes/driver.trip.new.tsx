import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
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
import { Search, UserPlus, X, Eraser, Loader2, Check } from "lucide-react";
import {
  createNemtTripGroup,
  attachRiderSignature,
  getMyDriverDefaults,
} from "@/lib/nemtTrip.functions";
import { generateStateFormPdf } from "@/lib/medicaidPdf";

export const Route = createFileRoute("/driver/trip/new")({
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
  const { user, isDriver } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("vehicle");

  // Vehicle / trip meta
  const [tripKind, setTripKind] = useState<"one_way" | "round_trip" | "group_tour">("one_way");
  const [vehicleType, setVehicleType] = useState<string>("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [escortName, setEscortName] = useState("");

  // Load driver defaults once
  const loadDefaults = useServerFn(getMyDriverDefaults);
  useEffect(() => {
    loadDefaults()
      .then((d: any) => {
        if (!d) return;
        if (d.default_vehicle_type) setVehicleType(d.default_vehicle_type);
        if (d.default_plate) setPlate(d.default_plate);
        if (d.default_vin) setVin(d.default_vin);
      })
      .catch(() => {});
  }, [loadDefaults]);

  // Riders
  const [riderSlots, setRiderSlots] = useState<RiderSlot[]>([]);
  const [riderQuery, setRiderQuery] = useState("");
  const [riderResults, setRiderResults] = useState<Rider[]>([]);
  const [addingRider, setAddingRider] = useState(false);
  const [newRider, setNewRider] = useState({ full_name: "", medicaid_id: "", dob: "", phone: "" });

  useEffect(() => {
    let cancelled = false;
    if (!riderQuery.trim()) {
      setRiderResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const q = `%${riderQuery.trim()}%`;
      const { data } = await supabase
        .from("riders")
        .select("*")
        .or(`full_name.ilike.${q},medicaid_id.ilike.${q}`)
        .limit(6);
      if (!cancelled) setRiderResults((data as Rider[]) ?? []);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [riderQuery]);

  function addRiderSlot(r: Rider) {
    if (riderSlots.some((s) => s.rider.id === r.id)) return;
    if (tripKind !== "group_tour" && riderSlots.length >= 1) {
      toast.info("Switch to Group Tour to add more than one rider");
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

  async function createNewRider() {
    if (!newRider.full_name || !newRider.medicaid_id) {
      toast.error("Name and Medicaid ID required");
      return;
    }
    const { data, error } = await supabase
      .from("riders")
      .insert({
        full_name: newRider.full_name.trim(),
        medicaid_id: newRider.medicaid_id.trim(),
        dob: newRider.dob || null,
        phone: newRider.phone || null,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    addRiderSlot(data as Rider);
    setAddingRider(false);
    setNewRider({ full_name: "", medicaid_id: "", dob: "", phone: "" });
  }

  // Legs
  const [legs, setLegs] = useState<LegForm[]>([emptyLeg(1)]);
  useEffect(() => {
    if (tripKind === "round_trip") {
      setLegs((prev) => (prev.length === 2 ? prev : [prev[0], emptyLeg(2)]));
    } else {
      setLegs((prev) => (prev.length === 1 ? prev : [prev[0]]));
    }
  }, [tripKind]);

  const updateLeg = (idx: number, patch: Partial<LegForm>) =>
    setLegs((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  // Signatures — canvases keyed by rider id
  const sigRefs = useRef<Record<string, SignatureCanvas | null>>({});

  function captureSignature(riderId: string) {
    const c = sigRefs.current[riderId];
    if (!c || c.isEmpty()) {
      toast.error("Please draw a signature first");
      return;
    }
    // getTrimmedCanvas is missing in some builds of react-signature-canvas —
    // fall back to the raw canvas which always works.
    const canvas =
      typeof (c as unknown as { getTrimmedCanvas?: () => HTMLCanvasElement }).getTrimmedCanvas === "function"
        ? (c as unknown as { getTrimmedCanvas: () => HTMLCanvasElement }).getTrimmedCanvas()
        : c.getCanvas();
    const url = canvas.toDataURL("image/png");
    setRiderSlots((prev) =>
      prev.map((s) => (s.rider.id === riderId ? { ...s, signature_data_url: url } : s)),
    );
    toast.success("Signature captured");
  }

  // Submit
  const submitGroup = useServerFn(createNemtTripGroup);
  const attachSig = useServerFn(attachRiderSignature);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (!vehicleType || !plate) return false;
    if (riderSlots.length === 0) return false;
    if (riderSlots.some((s) => !s.signature_data_url)) return false;
    for (const l of legs) {
      if (!l.pickup_address || !l.dropoff_address) return false;
      if (l.pickup_odometer === "" || l.dropoff_odometer === "") return false;
    }
    return true;
  }, [vehicleType, plate, riderSlots, legs]);

  async function handleSubmit() {
    if (!user) return;
    if (!canSubmit) return toast.error("Fill every step first");
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

      // Upload each rider signature and attach it to its matching trip row
      for (let i = 0; i < riderSlots.length; i++) {
        const slot = riderSlots[i];
        const tripId = res.trip_ids[i];
        const png = await (await fetch(slot.signature_data_url!)).blob();
        const path = `${user.id}/${tripId}.png`;
        const up = await supabase.storage
          .from("signatures")
          .upload(path, png, { upsert: true, contentType: "image/png" });
        if (up.error) throw up.error;
        await attachSig({
          data: {
            trip_id: tripId,
            signature_path: path,
            signature_name: slot.signer_name,
          },
        });
      }

      toast.success(
        riderSlots.length === 1
          ? "Trip submitted for review"
          : `${riderSlots.length} rider forms submitted for review`,
      );
      navigate({ to: "/driver/history" });
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

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <PageHeader
        title="Complete NEMT trip"
        description="Digital version of the Colorado NEMT Trip Report — one form per rider is generated automatically."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5 text-xs">
          <TabsTrigger value="vehicle">1. Vehicle</TabsTrigger>
          <TabsTrigger value="riders">2. Riders</TabsTrigger>
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
                <SelectItem value="group_tour">Group tour (multiple riders)</SelectItem>
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
            <Button onClick={() => setTab("riders")}>Next</Button>
          </div>
        </TabsContent>

        {/* ---------- STEP 2 ---------- */}
        <TabsContent value="riders" className="space-y-4 pt-4">
          <div className="rounded-xl border p-3">
            <Label className="text-sm font-semibold">Add rider</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search name or Medicaid ID"
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
                {riderResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => addRiderSlot(r)}
                    className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
                  >
                    <span>{r.full_name}</span>
                    <span className="text-xs text-muted-foreground">{r.medicaid_id}</span>
                  </button>
                ))}
              </div>
            )}
            {addingRider && (
              <div className="mt-3 space-y-2">
                <Input placeholder="Full legal name" value={newRider.full_name}
                  onChange={(e) => setNewRider({ ...newRider, full_name: e.target.value })} />
                <Input placeholder="Health First Colorado ID" value={newRider.medicaid_id}
                  onChange={(e) => setNewRider({ ...newRider, medicaid_id: e.target.value })} />
                <Input type="date" placeholder="DOB" value={newRider.dob}
                  onChange={(e) => setNewRider({ ...newRider, dob: e.target.value })} />
                <Input placeholder="Phone" value={newRider.phone}
                  onChange={(e) => setNewRider({ ...newRider, phone: e.target.value })} />
                <Button size="sm" onClick={createNewRider}>Save rider</Button>
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
                Add at least one rider.
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("vehicle")}>Back</Button>
            <Button onClick={() => setTab("legs")} disabled={riderSlots.length === 0}>Next</Button>
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
                  <Input type="number" inputMode="decimal" value={l.pickup_odometer}
                    onChange={(e) => updateLeg(i, { pickup_odometer: e.target.value })} />
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
                  <Input type="number" inputMode="decimal" value={l.dropoff_odometer}
                    onChange={(e) => updateLeg(i, { dropoff_odometer: e.target.value })} />
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
            <Button onClick={() => setTab("sign")}>Next</Button>
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
              <div className="rounded-lg border bg-white" style={{ touchAction: "none" }}>
                <SignatureCanvas
                  ref={(el) => { sigRefs.current[s.rider.id] = el; }}
                  canvasProps={{
                    width: 600,
                    height: 160,
                    className: "w-full h-40 rounded-lg touch-none",
                    style: { touchAction: "none" },
                  }}
                  penColor="#0f172a"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => {
                    sigRefs.current[s.rider.id]?.clear();
                    setRiderSlots((p) => p.map((x) =>
                      x.rider.id === s.rider.id ? { ...x, signature_data_url: null } : x));
                  }}>
                  <Eraser className="mr-1 h-4 w-4" /> Clear
                </Button>
                <Button size="sm" onClick={() => captureSignature(s.rider.id)}>
                  Capture
                </Button>
              </div>
            </div>
          ))}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("legs")}>Back</Button>
            <Button onClick={() => setTab("review")}
              disabled={riderSlots.some((s) => !s.signature_data_url)}>Next</Button>
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
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("sign")}>Back</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
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
