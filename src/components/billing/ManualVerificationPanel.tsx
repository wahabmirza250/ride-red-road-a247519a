import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Search, SearchCheck, ShieldAlert, PauseCircle } from "lucide-react";
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
import { verifyNoClaimFound } from "@/lib/manualVerification.functions";
import {
  getVerificationContext,
  keepVerificationHold,
  linkHcpfClaim,
  searchHcpfClaims,
} from "@/lib/hcpfVerify.functions";
import {
  friendlyLinkError,
  money,
  parseClaimConflict,
  type LinkedBill,
  type PortalClaim,
} from "@/lib/hcpfSearch";
import { verificationPanel, type VerificationPanelInput } from "@/lib/needsVerification";
import { formatDateTime } from "@/lib/format";

/**
 * VERIFY HCPF CLAIM.
 *
 * Always rendered on a verification-held bill. It shows the full evidence, can
 * run a READ-ONLY portal search, lists every claim the portal returned, and
 * offers the only safe exits — link a claim, record "no claim found", or keep
 * the bill on hold. Nothing here ever submits or queues a bill.
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
  const contextFn = useServerFn(getVerificationContext);
  const searchFn = useServerFn(searchHcpfClaims);
  const linkFn = useServerFn(linkHcpfClaim);
  const noneFn = useServerFn(verifyNoClaimFound);
  const holdFn = useServerFn(keepVerificationHold);

  const [claim, setClaim] = useState("");
  const [ack, setAck] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "found" | "none">(null);
  const [conflict, setConflict] = useState<{ claim: string; bill: LinkedBill } | null>(null);

  const ctx = useQuery({
    queryKey: ["verification_context", recordId],
    queryFn: () => contextFn({ data: { id: recordId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["billing_list"] });
    qc.invalidateQueries({ queryKey: ["billing_counts"] });
    qc.invalidateQueries({ queryKey: ["billing_detail", recordId] });
    qc.invalidateQueries({ queryKey: ["billing_queue"] });
  };

  const search = useMutation({
    mutationFn: () => searchFn({ data: { id: recordId } }),
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const link = useMutation({
    mutationFn: (n: string) =>
      linkFn({ data: { id: recordId, claim_number: n, acknowledged: true } }),
    onSuccess: () => {
      toast.success("Recorded — this bill is marked submitted with that claim number.");
      setConfirming(null);
      invalidate();
      onResolved?.();
    },
    onError: (e: any) => {
      setConfirming(null);
      const c = parseClaimConflict(e);
      if (c) {
        setConflict(c);
        return;
      }
      toast.error(friendlyLinkError(e));
    },
  });

  const none = useMutation({
    mutationFn: () => noneFn({ data: { id: recordId, acknowledged: true } }),
    onSuccess: () => {
      toast.success("Recorded — verified as not submitted and moved to Ready to Submit.");
      setConfirming(null);
      invalidate();
      onResolved?.();
    },
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const hold = useMutation({
    mutationFn: () => holdFn({ data: { id: recordId } }),
    onSuccess: () => {
      toast.success("Kept on hold — nothing was changed.");
      invalidate();
    },
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const busy = link.isPending || none.isPending || search.isPending || hold.isPending;
  const info = ctx.data;
  const result = search.data;
  const claims: PortalClaim[] = result?.claims ?? [];
  const autoLinkable =
    result?.decision?.kind === "auto" ? (result.decision as any).claim.claim_id : null;
  const chosen = selected ?? autoLinkable ?? "";
  const memberId = info?.medicaid_id || panel.memberId;
  const serviceDate = info?.service_date || panel.serviceDate;

  const startLink = (n: string) => {
    setClaim(n);
    setConfirming("found");
  };

  return (
    <div
      id="verify-hcpf-claim"
      className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-xs">
          <div className="text-sm font-semibold">Verify HCPF claim</div>
          <p className="mt-1">{panel.message}</p>
          <p className="mt-1">
            Nothing is submitted or queued by anything on this panel. Record what the portal shows
            and this bill moves on.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-background/60 p-2 text-xs sm:grid-cols-3">
        <Row label="Medicaid ID" value={memberId || "—"} mono />
        <Row label="Passenger" value={info?.passenger_name || panel.passengerName} />
        <Row label="Date of service" value={serviceDate} mono />
        <Row label="Trip ID" value={info?.trip_id ?? "—"} mono />
        <Row label="Odometer start" value={fmtNum(info?.odometer_start)} mono />
        <Row label="Odometer end" value={fmtNum(info?.odometer_end)} mono />
        <Row label="Miles" value={fmtNum(info?.miles)} mono />
        <Row label="Units" value={fmtNum(info?.units)} mono />
        <Row label="Provider account" value={info?.provider_account || panel.providerAccount} mono />
        <Row label="Robot job ID" value={info?.robot_job_id || panel.jobId} mono />
        <Row
          label="RedArt trips this day"
          value={info ? String(info.same_day_trip_count) : "—"}
          mono
        />
      </dl>

      {/* ---------- automatic read-only search ---------- */}
      <div className="space-y-2 rounded-lg bg-background/60 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => search.mutate()}>
            {search.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1 h-4 w-4" />
            )}
            Search HCPF automatically
          </Button>
          <span className="text-[11px] opacity-80">
            Read-only Claims → Search Claims for {memberId || "—"} on {serviceDate}.
          </span>
        </div>

        {search.isPending && (
          <p className="text-[11px] opacity-80">
            Read-only portal search running — this can take a couple of minutes. Nothing is
            submitted or changed while it runs.
          </p>
        )}
        {result && <p className="text-xs">{result.message}</p>}
        {result?.ok && claims.length === 0 && (
          <p className="text-xs font-semibold">No claim found in HCPF.</p>
        )}
        {result?.ok && (result.result_state || typeof result.match_count === "number") && (
          <p className="text-[11px] opacity-80">
            Portal result: {result.result_state ?? "—"}
            {typeof result.match_count === "number" ? ` · ${result.match_count} match(es)` : ""}
          </p>
        )}
        {result?.decision && <p className="text-[11px] opacity-80">{result.decision.reason}</p>}

        {claims.length > 0 && (
          <div className="space-y-2">
            {claims.map((c) => {
              const isSel = chosen === c.claim_id;
              return (
                <div
                  key={c.claim_id}
                  className={`rounded-lg border p-2 text-xs ${
                    isSel ? "border-primary bg-primary/5" : "border-border bg-background"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-sm font-semibold">{c.claim_id}</div>
                    <div className="flex flex-wrap gap-3 text-[11px]">
                      <span>Status: {c.status ?? "—"}</span>
                      <span>DOS: {c.service_date ?? serviceDate}</span>
                      <span>Paid: {money(c.paid_amount)}</span>
                      <span>Charge: {money(c.charge_amount)}</span>
                      <span>Units: {fmtNum(c.units)}</span>
                    </div>
                  </div>

                  {c.linked ? (
                    <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                      <div className="flex items-center gap-1 font-medium">
                        <ShieldAlert className="h-3.5 w-3.5" /> Already linked to another RedArt bill
                      </div>
                      <LinkedBillDetails bill={c.linked} />
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={isSel ? "default" : "secondary"}
                        disabled={busy}
                        onClick={() => setSelected(c.claim_id)}
                      >
                        {isSel ? "Selected" : "Select"}
                      </Button>
                      <Button size="sm" disabled={busy || !ack} onClick={() => startLink(c.claim_id)}>
                        <Check className="mr-1 h-4 w-4" /> Link this claim
                      </Button>
                      {!ack && (
                        <span className="self-center text-[11px]">
                          Tick the confirmation below first.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------- manual fallback, always available ---------- */}
      <div className="space-y-2 rounded-lg bg-background/60 p-2">
        <p className="text-xs font-medium">Manual result</p>
        <Label htmlFor="mv-claim" className="text-xs">
          Claim ID from HCPF (only if you found one)
        </Label>
        <Input
          id="mv-claim"
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="e.g. 2326240001014"
          className="font-mono"
        />
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={ack}
            onCheckedChange={(v) => setAck(v === true)}
            aria-label="I manually checked HCPF"
          />
          <span>
            I searched HCPF (Claims → Search Claims) for member {memberId || "—"} on {serviceDate}.
          </span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy || !ack || !claim.trim()}
            onClick={() => setConfirming("found")}
          >
            <Check className="mr-1 h-4 w-4" /> Claim found
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={busy || !ack}
            onClick={() => setConfirming("none")}
          >
            <SearchCheck className="mr-1 h-4 w-4" /> No claim found
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => hold.mutate()}
          >
            <PauseCircle className="mr-1 h-4 w-4" /> Keep on hold
          </Button>
        </div>
        {!ack && (
          <p className="text-[11px]">
            Tick the box above to confirm you checked the portal before recording a result.
          </p>
        )}
      </div>

      {/* ---------- conflict card ---------- */}
      <AlertDialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This HCPF claim is already linked to another RedArt bill</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>
                  Claim <span className="font-mono">{conflict?.claim}</span> is attached to a
                  different bill, so nothing was written here. This bill stays on verification hold.
                </p>
                {conflict?.bill && <LinkedBillDetails bill={conflict.bill} />}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConflict(null);
                hold.mutate();
              }}
            >
              Keep on hold
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- confirmations ---------- */}
      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "found"
                ? "Link this claim to this bill?"
                : "Record that no claim exists?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "found" ? (
                <>
                  The bill will be marked submitted with claim{" "}
                  <span className="font-mono">{claim.trim()}</span> for member {memberId} on{" "}
                  {serviceDate}. The original job and audit history are kept. Nothing is resubmitted.
                </>
              ) : (
                <>
                  You are confirming you checked HCPF for member {memberId} on {serviceDate} and
                  found no claim. The bill moves to Ready to Submit — it is NOT submitted or queued
                  by this action.
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
                if (confirming === "found") link.mutate(claim.trim());
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

function LinkedBillDetails({ bill }: { bill: LinkedBill }) {
  return (
    <dl className="mt-1 grid grid-cols-2 gap-1 text-[11px]">
      <Row label="Bill" value={bill.billing_record_id} mono />
      <Row label="Trip" value={bill.trip_id ?? "—"} mono />
      <Row label="Status" value={bill.status ?? "—"} />
      <Row label="Passenger" value={bill.passenger_name ?? "—"} />
      <Row label="Medicaid ID" value={bill.medicaid_id ?? "—"} mono />
      <Row
        label="Service date"
        value={bill.service_date ? formatDateTime(bill.service_date) : "—"}
      />
      <Row label="Odometer" value={`${fmtNum(bill.odometer_start)} → ${fmtNum(bill.odometer_end)}`} mono />
      <Row label="Miles" value={fmtNum(bill.miles)} mono />
    </dl>
  );
}

function fmtNum(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider opacity-70">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-xs"}>{value}</dd>
    </div>
  );
}
