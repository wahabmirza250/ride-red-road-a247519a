import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createManualPayrollItem } from "@/lib/payrollItems.functions";
import { listPayoutDrivers } from "@/lib/driverPayout.functions";
import { MANUAL_CATEGORIES, validateManualItem } from "@/lib/payrollItems";

const CATEGORY_LABEL: Record<string, string> = {
  manual_trip: "Manual trip",
  bonus: "Bonus",
  reimbursement: "Reimbursement",
  correction: "Correction",
  deduction: "Deduction",
  other: "Other",
};

/**
 * Manual payroll line for work handled outside the automated claim flow.
 * Negative amounts are only accepted as an explicit Adjustment.
 */
export function ManualPayrollItemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createManualPayrollItem);
  const driversFn = useServerFn(listPayoutDrivers);

  const drivers = useQuery({
    queryKey: ["payout_drivers"],
    queryFn: () => driversFn() as Promise<{ id: string; name: string }[]>,
    enabled: open,
  });

  const [driverId, setDriverId] = useState("");
  const [kind, setKind] = useState<"manual" | "adjustment">("manual");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [passenger, setPassenger] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("manual_trip");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          driver_id: driverId,
          kind,
          service_date: date,
          passenger_name: passenger || null,
          description,
          amount: Number(amount),
          category: category as never,
          notes: notes || null,
        },
      }) as Promise<{ id: string }>,
    onSuccess: () => {
      toast.success("Manual payroll item added");
      void qc.invalidateQueries({ queryKey: ["payroll_items"] });
      void qc.invalidateQueries({ queryKey: ["payroll_claims"] });
      onOpenChange(false);
      setDescription("");
      setAmount("");
      setNotes("");
      setPassenger("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save item"),
  });

  function submit() {
    const check = validateManualItem({
      kind,
      amount: Number(amount),
      description,
      driver_id: driverId || null,
      service_date: date,
    });
    if (!check.ok) return toast.error(check.error);
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual payroll item</DialogTitle>
          <DialogDescription>
            For work handled outside the automated trip/claim flow. It is stored with your name and
            shows a MANUAL badge on the payroll statement.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a driver" />
              </SelectTrigger>
              <SelectContent>
                {(drivers.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "manual" | "adjustment")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual item (positive)</SelectItem>
                  <SelectItem value="adjustment">Adjustment (+/−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Service / trip date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={kind === "adjustment" ? "-25.00" : "45.00"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Reason / category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c] ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Passenger / client (optional)</Label>
            <Input value={passenger} onChange={(e) => setPassenger(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cash trip billed directly to the facility"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Add to payroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
