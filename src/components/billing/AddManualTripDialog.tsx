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
import { createManualClaimTrip } from "@/lib/manualClaims.functions";
import { listPayoutDrivers } from "@/lib/driverPayout.functions";
import {
  MANUAL_CLAIM_STATUS_LABEL,
  MANUAL_CLAIM_STATUS_OPTIONS,
  validateManualClaim,
} from "@/lib/manualClaims";

/**
 * "+ Add Manual Trip" — an INTERNAL claim-history record for a trip handled
 * outside the automated HCPF flow. It is never submitted to the state portal.
 */
export function AddManualTripDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createManualClaimTrip);
  const driversFn = useServerFn(listPayoutDrivers);

  const drivers = useQuery({
    queryKey: ["payout_drivers"],
    queryFn: () => driversFn() as Promise<{ driver_id: string; name: string }[]>,
    enabled: open,
  });

  const [driverId, setDriverId] = useState("");
  const [passenger, setPassenger] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [claimNumber, setClaimNumber] = useState("");
  const [billed, setBilled] = useState("");
  const [pay, setPay] = useState("");
  const [status, setStatus] = useState<string>("internal");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          driver_id: driverId,
          passenger_name: passenger,
          service_date: date,
          claim_number: claimNumber || null,
          billed_amount: billed === "" ? null : Number(billed),
          driver_pay_amount: Number(pay),
          claim_status: status,
          notes: notes || null,
        },
      }) as Promise<{ id: string }>,
    onSuccess: () => {
      toast.success("Manual trip added to Claim History");
      void qc.invalidateQueries({ queryKey: ["manual_claims"] });
      void qc.invalidateQueries({ queryKey: ["claims_history"] });
      void qc.invalidateQueries({ queryKey: ["payroll_claims"] });
      onOpenChange(false);
      setPassenger("");
      setClaimNumber("");
      setBilled("");
      setPay("");
      setNotes("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save manual trip"),
  });

  function submit() {
    const check = validateManualClaim({
      driver_id: driverId || null,
      passenger_name: passenger,
      service_date: date,
      billed_amount: billed === "" ? null : Number(billed),
      driver_pay_amount: Number(pay),
    });
    if (!check.ok) return toast.error(check.error);
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add manual trip</DialogTitle>
          <DialogDescription>
            An internal Claim History record for a trip handled outside the automated flow. It is
            never submitted to the state portal, and the driver pay amount you enter here is used
            exactly as typed when it is added to payroll.
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
                  <SelectItem key={d.driver_id} value={d.driver_id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Passenger / client name</Label>
              <Input value={passenger} onChange={(e) => setPassenger(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Trip / service date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Claim number</Label>
              <Input
                value={claimNumber}
                onChange={(e) => setClaimNumber(e.target.value)}
                placeholder="Optional / external reference"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Claim status (optional)</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_CLAIM_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {MANUAL_CLAIM_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Amount billed ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={billed}
                onChange={(e) => setBilled(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Driver pay amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={pay}
                onChange={(e) => setPay(e.target.value)}
                placeholder="45.00"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Notes / reason (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save manual trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
