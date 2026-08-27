import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, SearchCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyClaimFound, verifyNoClaimFound } from "@/lib/manualVerification.functions";
import {
  verificationPanel,
  type VerificationPanelInput,
} from "@/lib/needsVerification";

/**
 * MANUAL HCPF VERIFICATION PANEL.
 *
 * Shown instead of Edit & fix / Resubmit whenever a bill's outcome is unknown.
 * It gives the biller the exact search terms and the only two safe exits, each
 * behind an explicit confirmation dialog and written to the audit log.
 */
export function ManualVerificationPanel({
  recordId,
  data,
  onResolved,
}: {
  recordId: string;
  data: VerificationPanelInput;
  onResolved?: () => void;
}) {
  const qc = useQueryClient();
  const panel = verificationPanel(data);
  const foundFn = useServerFn(verifyClaimFound);
  const noneFn = useServerFn(verifyNoClaimFound);

  const [claim, setClaim] = useState("");
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState<null | "found" | "none">(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["billing_list"] });
    qc.invalidateQueries({ queryKey: ["billing_counts"] });
    qc.invalidateQueries({ queryKey: ["billing_detail", recordId] });
    qc.invalidateQueries({ queryKey: ["billing_queue"] });
  };

  const found = useMutation({
    mutationFn: () =>
      foundFn({ data: { id: recordId, claim_number: claim.trim(), acknowledged: true } }),
    onSuccess: () => {
      toast.success("Recorded — the bill is marked submitted with that claim number.");
      setConfirming(null);
      invalidate();
      onResolved?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not record the claim number"),
  });

  const none = useMutation({
    mutationFn: () => noneFn({ data: { id: recordId, acknowledged: true } }),
    onSuccess: () => {
      toast.success("Recorded — verified as not submitted and moved to Ready to Submit.");
      setConfirming(null);
      invalidate();
      onResolved?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not record the verification"),
  });

  const busy = found.isPending || none.isPending;

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-xs">
          <div className="text-sm font-semibold">Needs verification — manual HCPF check</div>
          <p className="mt-1">{panel.message}</p>
          <p className="mt-1">
            Editing, resubmitting and moving this bill to Ready to Submit are blocked until it is
            reconciled.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-background/60 p-2 text-xs">
        <Row label="Member ID" value={panel.memberId} mono />
        <Row label="Passenger" value={panel.passengerName} />
        <Row label="Date of service" value={panel.serviceDate} mono />
        <Row label="Provider / account" value={panel.providerAccount} mono />
        <Row label="Robot job ID" value={panel.jobId} mono />
      </dl>

      <p className="text-xs">{panel.instructions}</p>

      <div className="space-y-2 rounded-lg bg-background/60 p-2">
        <Label htmlFor="mv-claim" className="text-xs">
          Claim ID from HCPF (only if you found one)
        </Label>
        <Input
          id="mv-claim"
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="e.g. 2026123456789"
          className="font-mono"
        />
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={ack}
            onCheckedChange={(v) => setAck(v === true)}
            aria-label="I manually checked HCPF"
          />
          <span>
            I manually searched HCPF (Claims → Search Claims) for member {panel.memberId} on{" "}
            {panel.serviceDate}.
          </span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy || !ack || !claim.trim()}
            onClick={() => setConfirming("found")}
          >
            <Check className="mr-1 h-4 w-4" /> Claim found in HCPF
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={busy || !ack}
            onClick={() => setConfirming("none")}
          >
            <SearchCheck className="mr-1 h-4 w-4" /> No claim found in HCPF
          </Button>
        </div>
        {!ack && (
          <p className="text-[11px]">
            Tick the box above to confirm you checked the portal before recording a result.
          </p>
        )}
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "found"
                ? "Record this claim as submitted?"
                : "Record that no claim exists?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "found" ? (
                <>
                  The bill will be marked submitted with claim{" "}
                  <span className="font-mono">{claim.trim()}</span> for member {panel.memberId} on{" "}
                  {panel.serviceDate}. The original job and audit history are kept.
                </>
              ) : (
                <>
                  You are confirming you checked HCPF for member {panel.memberId} on{" "}
                  {panel.serviceDate} and found no claim. The bill moves to Ready to Submit — it is
                  NOT submitted or queued by this action.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirming === "found") found.mutate();
                else none.mutate();
              }}
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider opacity-70">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-xs"}>{value}</dd>
    </div>
  );
}
