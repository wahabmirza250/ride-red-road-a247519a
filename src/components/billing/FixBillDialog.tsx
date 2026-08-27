import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Send, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBillForFix } from "@/lib/billFix.functions";
import {
  getBillingRecord,
  regenerateBillingPdf,
  startRobotForRecords,
} from "@/lib/billing.functions";

const CO_ID = /^[A-Za-z]\d{6}$/;

type Form = {
  medicaid_id: string;
  full_name: string;
  dob: string;
  phone: string;
  pickup_at: string;
  pickup_address: string;
  dropoff_address: string;
  odometer_start: string;
  odometer_end: string;
};

const EMPTY: Form = {
  medicaid_id: "",
  full_name: "",
  dob: "",
  phone: "",
  pickup_at: "",
  pickup_address: "",
  dropoff_address: "",
  odometer_start: "",
  odometer_end: "",
};

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Correct a bill that came back as "Needs fix" (wrong Medicaid ID, misread
 * name/DOB, bad odometer) and push it straight back through the normal
 * submission queue.
 */
export function FixBillDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const open = !!id;
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getBillingRecord);
  const saveFn = useServerFn(updateBillForFix);
  const regenFn = useServerFn(regenerateBillingPdf);
  const submitFn = useServerFn(startRobotForRecords);

  const [form, setForm] = useState<Form>(EMPTY);

  const detail = useQuery({
    queryKey: ["billing_detail", id],
    queryFn: () => fetchDetail({ data: { id: id! } }),
    enabled: open,
  });

  useEffect(() => {
    const d: any = detail.data;
    if (!d) return;
    const trip = d.trip ?? {};
    const rider = trip.riders ?? {};
    setForm({
      medicaid_id: rider.medicaid_id ?? "",
      full_name: rider.full_name ?? "",
      dob: rider.dob ?? "",
      phone: rider.phone ?? "",
      pickup_at: toLocalInput(trip.pickup_at),
      pickup_address: trip.pickup_address ?? "",
      dropoff_address: trip.dropoff_address ?? "",
      odometer_start: trip.odometer_start != null ? String(trip.odometer_start) : "",
      odometer_end: trip.odometer_end != null ? String(trip.odometer_end) : "",
    });
  }, [detail.data]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const idLooksWrong = !!form.medicaid_id && !CO_ID.test(form.medicaid_id.trim());

  const save = useMutation({
    mutationFn: async (resubmit: boolean) => {
      const payload = {
        id: id!,
        medicaid_id: form.medicaid_id.trim(),
        full_name: form.full_name.trim(),
        dob: form.dob || null,
        phone: form.phone || null,
        pickup_at: form.pickup_at ? new Date(form.pickup_at).toISOString() : undefined,
        pickup_address: form.pickup_address.trim(),
        dropoff_address: form.dropoff_address.trim(),
        odometer_start: form.odometer_start ? Number(form.odometer_start) : undefined,
        odometer_end: form.odometer_end ? Number(form.odometer_end) : undefined,
      };
      const res: any = await saveFn({ data: payload as never });
      // Keep the state PDF in sync with the corrected data.
      try {
        await regenFn({ data: { id: id! } });
      } catch {
        /* PDF regeneration is best-effort; the robot regenerates on submit */
      }
      if (resubmit) {
        await submitFn({ data: { ids: [id!], acknowledge_duplicate: false } as never });
      }
      return { res, resubmit };
    },
    onSuccess: ({ res, resubmit }) => {
      toast.success(
        resubmit
          ? "Saved and resubmitted — the bill is back in the submission queue."
          : res?.merged
            ? "Saved and merged onto the existing member record."
            : "Saved — the bill is back in Ready to Submit.",
      );
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
      qc.invalidateQueries({ queryKey: ["billing_queue"] });
      qc.invalidateQueries({ queryKey: ["billing_detail", id] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the correction"),
  });

  const err = (detail.data as any)?.record?.submission_error;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fix this bill</DialogTitle>
          <DialogDescription>
            Correct the data the portal rejected, then resubmit through the normal queue.
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {err && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                {err}
              </div>
            )}

            <ViewScannedFormButton
              className="w-full"
              tripId={(detail.data as any)?.trip?.id ?? null}
              pdfUrl={(detail.data as any)?.pdf_url ?? null}
              passengerName={form.full_name || null}
            />


            <div className="space-y-1.5">
              <Label htmlFor="fix-mid">Medicaid ID</Label>
              <Input
                id="fix-mid"
                value={form.medicaid_id}
                onChange={set("medicaid_id")}
                className="font-mono uppercase"
              />
              {idLooksWrong && (
                <p className="text-xs text-amber-600">
                  Colorado member IDs are one letter followed by 6 digits (e.g. D260223). The
                  portal rejects anything else on Step 1.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fix-name">Passenger name</Label>
              <Input id="fix-name" value={form.full_name} onChange={set("full_name")} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fix-dob">Date of birth</Label>
                <Input id="fix-dob" type="date" value={form.dob} onChange={set("dob")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fix-phone">Phone</Label>
                <Input id="fix-phone" value={form.phone} onChange={set("phone")} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fix-date">Trip date &amp; time</Label>
              <Input
                id="fix-date"
                type="datetime-local"
                value={form.pickup_at}
                onChange={set("pickup_at")}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fix-odo-start">Odometer start</Label>
                <Input
                  id="fix-odo-start"
                  inputMode="decimal"
                  value={form.odometer_start}
                  onChange={set("odometer_start")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fix-odo-end">Odometer end</Label>
                <Input
                  id="fix-odo-end"
                  inputMode="decimal"
                  value={form.odometer_end}
                  onChange={set("odometer_end")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fix-pickup">Pickup address</Label>
              <Input id="fix-pickup" value={form.pickup_address} onChange={set("pickup_address")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fix-drop">Dropoff address</Label>
              <Input
                id="fix-drop"
                value={form.dropoff_address}
                onChange={set("dropoff_address")}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => save.mutate(false)}
            disabled={save.isPending || detail.isLoading}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save only
          </Button>
          <Button
            onClick={() => save.mutate(true)}
            disabled={save.isPending || detail.isLoading}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Save &amp; resubmit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
