import { createFileRoute } from "@tanstack/react-router";
import { useAppNavigate } from "@/lib/appLink";
import { useEffect, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Search, UserPlus, Eraser, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-trips/new")({
  component: NewMedicaidTripPage,
});

type Rider = {
  id: string;
  full_name: string;
  medicaid_id: string;
  dob: string | null;
  phone: string | null;
  address: string | null;
};

function NewMedicaidTripPage() {
  const { user } = useAuth();
  const navigate = useAppNavigate();
  const [tab, setTab] = useState("trip");

  // Rider search
  const [riderQuery, setRiderQuery] = useState("");
  const [riderResults, setRiderResults] = useState<Rider[]>([]);
  const [rider, setRider] = useState<Rider | null>(null);
  const [addingRider, setAddingRider] = useState(false);
  const [newRider, setNewRider] = useState({
    full_name: "",
    medicaid_id: "",
    dob: "",
    phone: "",
    address: "",
  });

  useEffect(() => {
    if (!riderQuery || riderQuery.length < 2 || rider) {
      setRiderResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("riders")
        .select("id, full_name, medicaid_id, dob, phone, address")
        .or(`full_name.ilike.%${riderQuery}%,medicaid_id.ilike.%${riderQuery}%`)
        .limit(10);
      setRiderResults((data as Rider[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [riderQuery, rider]);

  // Trip fields
  const now = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }, []);
  const [pickupAt, setPickupAt] = useState(now);
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [odoStart, setOdoStart] = useState("");
  const [odoEnd, setOdoEnd] = useState("");
  const miles = useMemo(() => {
    const s = parseFloat(odoStart);
    const e = parseFloat(odoEnd);
    return isFinite(s) && isFinite(e) && e >= s ? +(e - s).toFixed(1) : 0;
  }, [odoStart, odoEnd]);
  const [milesOverride, setMilesOverride] = useState("");

  // Signature
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);

  const clearSig = () => {
    sigRef.current?.clear();
    setSigned(false);
  };

  async function addRider() {
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
        address: newRider.address || null,
        created_by: user!.id,
      })
      .select("id, full_name, medicaid_id, dob, phone, address")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setRider(data as Rider);
    setAddingRider(false);
    setSignerName((data as Rider).full_name);
    setNewRider({ full_name: "", medicaid_id: "", dob: "", phone: "", address: "" });
    toast.success("Rider added");
  }

  async function submit() {
    if (!rider) return toast.error("Pick a rider");
    if (!pickupAddress || !dropoffAddress) return toast.error("Addresses required");
    if (!odoStart || !odoEnd) return toast.error("Odometer required");
    const finalMiles = parseFloat(milesOverride || String(miles));
    if (!finalMiles || finalMiles <= 0) return toast.error("Miles must be > 0");
    if (!signed || sigRef.current?.isEmpty()) return toast.error("Rider signature required");
    if (!signerName.trim()) return toast.error("Signer name required");

    setSaving(true);
    try {
      const tripId = crypto.randomUUID();
      // upload signature
      const dataUrl = sigRef.current!.getTrimmedCanvas().toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();
      const path = `${user!.id}/${tripId}.png`;
      const { error: upErr } = await supabase.storage
        .from("signatures")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;

      const { error } = await supabase.from("medicaid_trips").insert({
        id: tripId,
        driver_id: user!.id,
        rider_id: rider.id,
        pickup_at: new Date(pickupAt).toISOString(),
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        odometer_start: parseFloat(odoStart),
        odometer_end: parseFloat(odoEnd),
        miles: finalMiles,
        signature_path: path,
        signature_name: signerName.trim(),
        status: "pending_review",
      });
      if (error) throw error;
      toast.success("Trip submitted for review");
      navigate({ to: "/medicaid-trips" });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Medicaid Trip"
        description="Fill out the Colorado state form"
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="trip">1. Trip details</TabsTrigger>
          <TabsTrigger value="sign">2. Rider signature</TabsTrigger>
        </TabsList>

        <TabsContent value="trip" className="space-y-5 pt-4">
          {/* Rider picker */}
          <section className="rounded-2xl border border-border bg-surface p-4">
            <Label className="text-sm font-semibold">Rider</Label>
            {rider ? (
              <div className="mt-2 flex items-center justify-between rounded-xl bg-primary/5 p-3">
                <div>
                  <div className="text-sm font-medium">{rider.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Medicaid {rider.medicaid_id}
                    {rider.dob ? ` · DOB ${rider.dob}` : ""}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRider(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={riderQuery}
                    onChange={(e) => setRiderQuery(e.target.value)}
                    placeholder="Search name or Medicaid ID"
                    className="pl-9"
                  />
                </div>
                {riderResults.length > 0 && (
                  <div className="mt-2 divide-y rounded-xl border">
                    {riderResults.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setRider(r);
                          setSignerName(r.full_name);
                          setRiderQuery("");
                        }}
                        className="flex w-full items-center justify-between p-3 text-left hover:bg-accent"
                      >
                        <span className="text-sm font-medium">{r.full_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.medicaid_id}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setAddingRider((v) => !v)}
                >
                  <UserPlus className="mr-1 h-4 w-4" />
                  {addingRider ? "Cancel" : "Add new rider"}
                </Button>
                {addingRider && (
                  <div className="mt-3 grid gap-3 rounded-xl border border-dashed p-3">
                    <Input
                      placeholder="Full name"
                      value={newRider.full_name}
                      onChange={(e) =>
                        setNewRider({ ...newRider, full_name: e.target.value })
                      }
                    />
                    <Input
                      placeholder="Medicaid ID"
                      value={newRider.medicaid_id}
                      onChange={(e) =>
                        setNewRider({ ...newRider, medicaid_id: e.target.value })
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="date"
                        placeholder="DOB"
                        value={newRider.dob}
                        onChange={(e) =>
                          setNewRider({ ...newRider, dob: e.target.value })
                        }
                      />
                      <Input
                        placeholder="Phone"
                        value={newRider.phone}
                        onChange={(e) =>
                          setNewRider({ ...newRider, phone: e.target.value })
                        }
                      />
                    </div>
                    <AddressAutocomplete
                      placeholder="Home address"
                      value={newRider.address}
                      onChange={(v) => setNewRider({ ...newRider, address: v })}
                      onResolve={(p) => setNewRider({ ...newRider, address: p.address })}
                    />
                    <Button size="sm" onClick={addRider}>
                      Save rider
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Trip fields */}
          <section className="grid gap-4 rounded-2xl border border-border bg-surface p-4">
            <div>
              <Label>Pickup date & time</Label>
              <Input
                type="datetime-local"
                value={pickupAt}
                onChange={(e) => setPickupAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Pickup address</Label>
              <AddressAutocomplete
                value={pickupAddress}
                onChange={setPickupAddress}
                onResolve={(p) => setPickupAddress(p.address)}
                placeholder="Street, city, ZIP"
              />
            </div>
            <div>
              <Label>Drop-off address</Label>
              <AddressAutocomplete
                value={dropoffAddress}
                onChange={setDropoffAddress}
                onResolve={(p) => setDropoffAddress(p.address)}
                placeholder="Street, city, ZIP"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Odometer start</Label>
                <Input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={odoStart}
                  onChange={(e) => setOdoStart(e.target.value)}
                />
              </div>
              <div>
                <Label>Odometer end</Label>
                <Input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={odoEnd}
                  onChange={(e) => setOdoEnd(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Miles driven</Label>
              <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm tabular-nums">
                {miles} mi
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Always calculated as ending odometer − starting odometer.
              </p>
            </div>

          </section>

          <div className="flex justify-end">
            <Button onClick={() => setTab("sign")}>Continue to signature →</Button>
          </div>
        </TabsContent>

        <TabsContent value="sign" className="space-y-4 pt-4">
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
            <div className="font-semibold text-primary">Hand phone to rider</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Rider: please sign below to confirm this trip took place as recorded.
            </div>
          </div>

          <div>
            <Label>Signer's printed name</Label>
            <Input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full name"
            />
          </div>

          <div>
            <Label>Signature</Label>
            <div className="mt-1 overflow-hidden rounded-2xl border-2 border-dashed border-border bg-surface">
              <SignatureCanvas
                ref={(r) => {
                  sigRef.current = r;
                }}
                penColor="#111827"
                canvasProps={{
                  className: "w-full h-56 touch-none bg-white",
                }}
                onEnd={() => setSigned(true)}
              />
            </div>
            <div className="mt-2 flex justify-between">
              <Button variant="ghost" size="sm" onClick={clearSig}>
                <Eraser className="mr-1 h-4 w-4" /> Clear
              </Button>
              {signed ? (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <Check className="h-4 w-4" /> Signed
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Sign inside the box
                </span>
              )}
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => setTab("trip")}>
              ← Back
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Submit for billing
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
