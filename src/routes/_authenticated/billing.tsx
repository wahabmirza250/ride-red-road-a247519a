import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
});

type Billing = {
  id: string;
  trip_id: string;
  amount: number;
  service_code: string | null;
  diagnosis_code: string | null;
  units: number;
  rate_per_unit: number;
  status: "pending" | "submitted" | "paid" | "rejected";
  submitted_at: string | null;
  paid_at: string | null;
  created_at: string;
};

type TripLite = {
  id: string;
  scheduled_pickup_time: string;
  pickup_address: string;
  dropoff_address: string;
  billing_status: string;
  status: string;
};

function BillingPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [edit, setEdit] = useState<Billing | null>(null);

  const records = useQuery({
    queryKey: ["billing", status],
    queryFn: async () => {
      let q = supabase.from("billing_records").select("*").order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status as "pending" | "submitted" | "paid" | "rejected");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Billing[];
    },
  });

  const completedTrips = useQuery({
    queryKey: ["completed-trips-for-billing"],
    queryFn: async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, scheduled_pickup_time, pickup_address, dropoff_address, billing_status, status")
        .eq("status", "completed")
        .order("actual_dropoff_time", { ascending: false });
      return (data ?? []) as TripLite[];
    },
  });

  const missing = (completedTrips.data ?? []).filter(
    (t) => !records.data?.some((r) => r.trip_id === t.id),
  );

  const createFor = useMutation({
    mutationFn: async (tripId: string) => {
      const { error } = await supabase.from("billing_records").insert({ trip_id: tripId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast.success("Billing record created");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="HCPF submission tracking." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {missing.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {missing.length} completed trip(s) missing a billing record.{" "}
            <button
              className="text-primary hover:underline"
              onClick={() => missing.forEach((t) => createFor.mutate(t.id))}
            >
              Create them all
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Trip</th>
              <th className="px-4 py-3 text-left">Service</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {records.isLoading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : records.data?.length ? (
              records.data.map((r) => (
                <tr key={r.id} onClick={() => setEdit(r)} className="cursor-pointer hover:bg-accent/60">
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.trip_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{r.service_code ?? "—"}</td>
                  <td className="px-4 py-3 font-medium tabular-nums">{formatCurrency(Number(r.amount))}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No billing records yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && <EditBillingDialog record={edit} onClose={() => setEdit(null)} />}
      </Dialog>
    </div>
  );
}

function EditBillingDialog({ record, onClose }: { record: Billing; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    service_code: record.service_code ?? "",
    diagnosis_code: record.diagnosis_code ?? "",
    units: String(record.units),
    rate_per_unit: String(record.rate_per_unit),
    status: record.status,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const units = Number(f.units);
    const rate = Number(f.rate_per_unit);
    const amount = units * rate;
    const patch: Partial<Billing> = {
      service_code: f.service_code || null,
      diagnosis_code: f.diagnosis_code || null,
      units,
      rate_per_unit: rate,
      amount,
      status: f.status,
    };
    if (f.status === "submitted" && !record.submitted_at) patch.submitted_at = new Date().toISOString();
    if (f.status === "paid" && !record.paid_at) patch.paid_at = new Date().toISOString();
    const { error } = await supabase.from("billing_records").update(patch).eq("id", record.id);
    // mirror status onto the trip too
    await supabase.from("trips").update({ billing_status: f.status }).eq("id", record.trip_id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["billing"] });
    qc.invalidateQueries({ queryKey: ["trips"] });
    onClose();
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Edit billing</DialogTitle></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>Service code</Label><Input value={f.service_code} onChange={(e) => setF({ ...f, service_code: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Diagnosis code</Label><Input value={f.diagnosis_code} onChange={(e) => setF({ ...f, diagnosis_code: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Units</Label><Input type="number" step="0.01" value={f.units} onChange={(e) => setF({ ...f, units: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Rate / unit</Label><Input type="number" step="0.01" value={f.rate_per_unit} onChange={(e) => setF({ ...f, rate_per_unit: e.target.value })} /></div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Status</Label>
          <Select value={f.status} onValueChange={(v: Billing["status"]) => setF({ ...f, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
      </DialogFooter>
    </DialogContent>
  );
}
