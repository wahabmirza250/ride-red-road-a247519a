import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { supabase } from "@/integrations/supabase/client";
import { friendlyErrorMessage } from "@/lib/errorMessage";
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
  has_second_leg: boolean;
  leg2_date: string;
  leg2_pickup_time: string;
  leg2_pickup_address: string;
  leg2_pickup_odometer: string;
  leg2_dropoff_time: string;
  leg2_dropoff_address: string;
  leg2_dropoff_odometer: string;
};

const EMPTY: ReportForm = {
  identity_verified: "", vehicle_type: "", trip_kind: "one_way", escort_name: "",
  vehicle_plate: "", vehicle_vin: "", leg_date: "", pickup_time: "", pickup_address: "",
  pickup_odometer: "", dropoff_time: "", dropoff_address: "", dropoff_odometer: "",
  signed_by_escort: false,
  has_second_leg: false, leg2_date: "", leg2_pickup_time: "", leg2_pickup_address: "",
  leg2_pickup_odometer: "", leg2_dropoff_time: "", leg2_dropoff_address: "", leg2_dropoff_odometer: "",
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

  const loadDraft = useCallback(async (): Promise<ReportForm> => {
    try {
      const result = await load({ data: { trip_id: tripId } });
      return normalize(result.form_data);
    } catch {
      // Server function unavailable (edge 500 / HTML shell) — read directly with RLS.
      return await loadDraftFromDatabase(tripId);
    }
  }, [load, tripId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    loadDraft()
      .then((next) => {
        if (!cancelled) setForm(next);
      })
      .catch((error) => toast.error(friendlyErrorMessage(error, "Could not load trip report")))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadDraft, open]);

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
      // Fall back to saving the draft directly so edits are never lost.
      const { error: saveError } = await supabase
        .from("dispatch_trip_report_drafts")
        .upsert(
          { dispatch_trip_id: tripId, form_data: form as unknown as Record<string, unknown> } as never,
          { onConflict: "dispatch_trip_id" },
        );
      if (saveError) {
        toast.error(friendlyErrorMessage(error, "Could not save trip report"));
      } else {
        toast.success("Trip report saved. PDF regeneration is unavailable right now.");
      }
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

              <div className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Second leg / stop (box 2 on the form)</p>
                    <p className="text-xs text-muted-foreground">Add the return or extra stop the driver forgot to record.</p>
                  </div>
                  {form.has_second_leg ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => field("has_second_leg", false)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          has_second_leg: true,
                          trip_kind: current.trip_kind === "one_way" ? "round_trip" : current.trip_kind,
                          leg2_date: current.leg2_date || current.leg_date,
                          leg2_pickup_address: current.leg2_pickup_address || current.dropoff_address,
                          leg2_pickup_odometer: current.leg2_pickup_odometer || current.dropoff_odometer,
                          leg2_dropoff_address: current.leg2_dropoff_address || current.pickup_address,
                        }))
                      }
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add stop
                    </Button>
                  )}
                </div>
                {form.has_second_leg && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Leg 2 date" type="date" value={form.leg2_date} onChange={(v) => field("leg2_date", v)} />
                      <TextField label="Leg 2 pickup time" type="time" value={form.leg2_pickup_time} onChange={(v) => field("leg2_pickup_time", v)} />
                      <TextField label="Leg 2 pickup odometer" value={form.leg2_pickup_odometer} onChange={(v) => field("leg2_pickup_odometer", v)} />
                      <TextField label="Leg 2 drop-off odometer" value={form.leg2_dropoff_odometer} onChange={(v) => field("leg2_dropoff_odometer", v)} />
                    </div>
                    <TextField label="Leg 2 pickup address" value={form.leg2_pickup_address} onChange={(v) => field("leg2_pickup_address", v)} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Leg 2 drop-off time" type="time" value={form.leg2_dropoff_time} onChange={(v) => field("leg2_dropoff_time", v)} />
                    </div>
                    <TextField label="Leg 2 drop-off address" value={form.leg2_dropoff_address} onChange={(v) => field("leg2_dropoff_address", v)} />
                  </div>
                )}
              </div>

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
    <Button size="sm" onClick={async () => { setLoading(true); try { const r = await ensurePdf({ data: { trip_id: tripId } }); if (!r.url) throw new Error("No PDF is available"); setUrl(r.url); } catch (e) { toast.error(friendlyErrorMessage(e, "Could not open PDF")); } finally { setLoading(false); } }} disabled={loading}>
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

/** Client-side fallback used when the server function is unreachable. */
async function loadDraftFromDatabase(tripId: string): Promise<ReportForm> {
  const [{ data: draft }, { data: trip }] = await Promise.all([
    supabase
      .from("dispatch_trip_report_drafts")
      .select("form_data")
      .eq("dispatch_trip_id", tripId)
      .maybeSingle(),
    supabase
      .from("trips")
      .select(
        "pickup_address, dropoff_address, scheduled_pickup_time, actual_pickup_time, actual_dropoff_time, odometer_start, odometer_end",
      )
      .eq("id", tripId)
      .maybeSingle(),
  ]);

  const pickupIso = trip?.actual_pickup_time ?? trip?.scheduled_pickup_time ?? "";
  const dropoffIso = trip?.actual_dropoff_time ?? "";
  const defaults: ReportForm = {
    ...EMPTY,
    leg_date: pickupIso ? pickupIso.slice(0, 10) : "",
    pickup_time: pickupIso ? pickupIso.slice(11, 16) : "",
    dropoff_time: dropoffIso ? dropoffIso.slice(11, 16) : "",
    pickup_address: trip?.pickup_address ?? "",
    dropoff_address: trip?.dropoff_address ?? "",
    pickup_odometer: trip?.odometer_start != null ? String(trip.odometer_start) : "",
    dropoff_odometer: trip?.odometer_end != null ? String(trip.odometer_end) : "",
  };
  return { ...defaults, ...normalizePartial(draft?.form_data) };
}

function normalizePartial(value: unknown): Partial<ReportForm> {
  if (!value || typeof value !== "object") return {};
  return value as Partial<ReportForm>;
}
