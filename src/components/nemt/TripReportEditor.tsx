import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { ensureDispatchTripStatePdf, getTripReportDraft, saveTripReportDraft } from "@/lib/nemtTrip.functions";

type ReportForm = {
  identity_verified: "yes" | "no" | "";
  vehicle_type: "ground_ambulance" | "wheelchair_van" | "stretcher_van" | "taxi" | "ambulatory" | "";
  trip_kind: "one_way" | "round_trip" | "group_tour";
  escort_name: string;
  vehicle_plate: string;
  vehicle_vin: string;
  leg_date: string;
  pickup_time: string;
  pickup_address: string;
  pickup_odometer: string;
  dropoff_time: string;
  dropoff_address: string;
  dropoff_odometer: string;
  signed_by_escort: boolean;
};

const EMPTY: ReportForm = {
  identity_verified: "", vehicle_type: "", trip_kind: "one_way", escort_name: "",
  vehicle_plate: "", vehicle_vin: "", leg_date: "", pickup_time: "", pickup_address: "",
  pickup_odometer: "", dropoff_time: "", dropoff_address: "", dropoff_odometer: "",
  signed_by_escort: false,
};

export function TripReportEditor({ tripId, triggerLabel = "Edit HCPF" }: { tripId: string; triggerLabel?: string }) {
  const load = useServerFn(getTripReportDraft);
  const save = useServerFn(saveTripReportDraft);
  const ensurePdf = useServerFn(ensureDispatchTripStatePdf);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ReportForm>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    load({ data: { trip_id: tripId } })
      .then((result) => {
        if (cancelled) return;
        setForm(normalize(result.form_data));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load trip report"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load, open, tripId]);

  function field<K extends keyof ReportForm>(key: K, value: ReportForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveAndRegenerate() {
    setSaving(true);
    try {
      await save({ data: { trip_id: tripId, form_data: form } });
      const result = await ensurePdf({ data: { trip_id: tripId, force: true } });
      if (!result.url) throw new Error("PDF regenerated but no download link was returned");
      setPdfUrl(result.url);
      toast.success("Trip report saved and PDF regenerated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save trip report");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" /> {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Edit HCPF trip report</DialogTitle></DialogHeader>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField label="Identity verified" value={form.identity_verified || "blank"} onChange={(v) => field("identity_verified", v === "blank" ? "" : v as ReportForm["identity_verified"])} options={[["blank", "Leave blank"], ["yes", "Yes"], ["no", "No"]]} />
                <SelectField label="Vehicle type" value={form.vehicle_type || "blank"} onChange={(v) => field("vehicle_type", v === "blank" ? "" : v as ReportForm["vehicle_type"])} options={[["blank", "Leave blank"], ["ground_ambulance", "Ground ambulance"], ["wheelchair_van", "Wheelchair van"], ["stretcher_van", "Stretcher van"], ["taxi", "Taxi"], ["ambulatory", "Ambulatory"]]} />
                <SelectField label="Trip type" value={form.trip_kind} onChange={(v) => field("trip_kind", v as ReportForm["trip_kind"])} options={[["one_way", "One way"], ["round_trip", "Round trip"], ["group_tour", "Group tour"]]} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Trip date" type="date" value={form.leg_date} onChange={(v) => field("leg_date", v)} />
                <TextField label="Escort name" value={form.escort_name} onChange={(v) => field("escort_name", v)} />
                <TextField label="Vehicle plate" value={form.vehicle_plate} onChange={(v) => field("vehicle_plate", v)} />
                <TextField label="Vehicle VIN" value={form.vehicle_vin} onChange={(v) => field("vehicle_vin", v)} />
                <TextField label="Pickup time" type="time" value={form.pickup_time} onChange={(v) => field("pickup_time", v)} />
                <TextField label="Pickup odometer" value={form.pickup_odometer} onChange={(v) => field("pickup_odometer", v)} />
              </div>
              <TextField label="Pickup address" value={form.pickup_address} onChange={(v) => field("pickup_address", v)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Drop-off time" type="time" value={form.dropoff_time} onChange={(v) => field("dropoff_time", v)} />
                <TextField label="Drop-off odometer" value={form.dropoff_odometer} onChange={(v) => field("dropoff_odometer", v)} />
              </div>
              <TextField label="Drop-off address" value={form.dropoff_address} onChange={(v) => field("dropoff_address", v)} />
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.signed_by_escort} onCheckedChange={(v) => field("signed_by_escort", v === true)} /> Signed by escort or facility</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={saveAndRegenerate} disabled={loading || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Save &amp; regenerate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PdfPreviewDialog url={pdfUrl} filename={`hcpf-trip-${tripId.slice(0, 8)}.pdf`} onClose={() => setPdfUrl(null)} />
    </>
  );
}

export function TripPdfButton({ tripId }: { tripId: string }) {
  const ensurePdf = useServerFn(ensureDispatchTripStatePdf);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  return <>
    <Button size="sm" onClick={async () => { setLoading(true); try { const r = await ensurePdf({ data: { trip_id: tripId } }); if (!r.url) throw new Error("No PDF is available"); setUrl(r.url); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open PDF"); } finally { setLoading(false); } }} disabled={loading}>
      {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />} View / download
    </Button>
    <PdfPreviewDialog url={url} filename={`hcpf-trip-${tripId.slice(0, 8)}.pdf`} onClose={() => setUrl(null)} />
  </>;
}

function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Input type={type} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>;
}

function normalize(value: unknown): ReportForm {
  if (!value || typeof value !== "object") return EMPTY;
  return { ...EMPTY, ...(value as Partial<ReportForm>) };
}