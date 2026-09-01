/**
 * EDI Submission — the real happy path:
 *   create/link claim → validate → create batch → generate 837P → queue/upload.
 *
 * TEST is the default everywhere. A production submission always requires an
 * explicit typed confirmation. The legacy HCPF/robot path is untouched.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Rocket, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getEdiTripDetail, saveEdiClaimState } from "@/lib/ediBilling.functions";
import { createEdiBatch, generateEdi837P, submitEdiBatch } from "@/lib/edi.functions";
import { ediIsValid } from "@/lib/edi";
import {
  PRODUCTION_CONFIRM_PHRASE,
  isProductionConfirmed,
  type EdiEnvironment,
} from "@/lib/ediSetup";

export function EdiSubmissionTab({
  recordId,
  environment,
}: {
  recordId: string | null;
  environment: EdiEnvironment;
}) {
  const detailFn = useServerFn(getEdiTripDetail);
  const saveFn = useServerFn(saveEdiClaimState);
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const detail = useQuery({
    queryKey: ["edi_trip_detail", recordId],
    queryFn: () => detailFn({ data: { record_id: recordId! } }),
    enabled: !!recordId,
  });

  const d = detail.data;
  const validation = d?.edi.edi_validation_json
    ? (JSON.parse(d.edi.edi_validation_json) as Record<string, unknown>)
    : null;
  const ready = validation ? ediIsValid(validation) === true : false;

  const refresh = () => qc.invalidateQueries({ queryKey: ["edi_trip_detail", recordId] });

  const batch = useMutation({
    mutationFn: async () => {
      const claimId = d!.edi.edi_claim_id;
      if (!claimId) throw new Error("Create and validate the EDI claim first");
      const res = await createEdiBatch({ claim_ids: [claimId], environment });
      if (!res.ok) throw new Error(res.error);
      const batchId = Number(res.data?.id ?? 0) || null;
      await saveFn({
        data: { record_id: d!.record_id, edi_batch_id: batchId, edi_status: "batched" },
      });
      return batchId;
    },
    onSuccess: () => {
      toast.success("Batch created");
      void refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Batch failed"),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const batchId = d!.edi.edi_batch_id;
      if (!batchId) throw new Error("Create the batch first");
      const res = await generateEdi837P(batchId);
      if (!res.ok) {
        await saveFn({ data: { record_id: d!.record_id, edi_last_error: res.error } });
        throw new Error(res.error);
      }
      await saveFn({
        data: {
          record_id: d!.record_id,
          edi_file_id: Number(res.data?.id ?? 0) || null,
          edi_status: "generated",
          edi_last_error: null,
        },
      });
    },
    onSuccess: () => {
      toast.success("837P generated");
      void refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Generation failed"),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const batchId = d!.edi.edi_batch_id;
      if (!batchId) throw new Error("Nothing to submit yet");
      const res = await submitEdiBatch(batchId, environment);
      if (!res.ok) {
        await saveFn({ data: { record_id: d!.record_id, edi_last_error: res.error } });
        throw new Error(res.error);
      }
      await saveFn({
        data: {
          record_id: d!.record_id,
          edi_status: environment === "production" ? "submitted" : "submitted_test",
          edi_last_error: null,
        },
      });
    },
    onSuccess: () => {
      toast.success(environment === "production" ? "Submitted to payer" : "Queued in TEST");
      setConfirmOpen(false);
      setTyped("");
      void refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Submission failed"),
  });

  if (!recordId) return <Empty>Select a trip first.</Empty>;
  if (detail.isLoading || !d) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="EDI claim ID" value={d.edi.edi_claim_id ?? "—"} />
        <Stat label="Batch ID" value={d.edi.edi_batch_id ?? "—"} />
        <Stat label="File ID (837P)" value={d.edi.edi_file_id ?? "—"} />
        <Stat label="EDI status" value={d.edi.edi_status ?? "—"} />
      </div>

      {d.edi.edi_last_error && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{d.edi.edi_last_error}</span>
        </p>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Submission pipeline</h3>
          <Badge variant={environment === "production" ? "destructive" : "secondary"}>
            {environment === "production" ? "PRODUCTION" : "TEST"}
          </Badge>
        </div>

        <ol className="space-y-3">
          <Step index={1} title="Claim created & validated" done={ready}>
            {ready
              ? "Backend reports this claim is ready for 837P generation."
              : "Run Validate EDI in Review Billing — submission stays locked until the backend says ready."}
          </Step>
          <Step index={2} title="Batch created" done={!!d.edi.edi_batch_id}>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!ready || batch.isPending || !!d.edi.edi_batch_id}
              onClick={() => batch.mutate()}
            >
              {batch.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Create batch
            </Button>
          </Step>
          <Step index={3} title="837P generated" done={!!d.edi.edi_file_id}>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!d.edi.edi_batch_id || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Generate 837P
            </Button>
          </Step>
          <Step
            index={4}
            title="Queued / uploaded to payer"
            done={String(d.edi.edi_status ?? "").startsWith("submitted")}
          >
            <Button
              size="sm"
              className="rounded-full"
              disabled={!d.edi.edi_file_id || submit.isPending}
              onClick={() =>
                environment === "production" ? setConfirmOpen(true) : submit.mutate()
              }
            >
              {submit.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="mr-2 h-3.5 w-3.5" />
              )}
              {environment === "production" ? "Submit to PRODUCTION" : "Queue TEST submission"}
            </Button>
          </Step>
        </ol>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" /> Confirm production submission
            </DialogTitle>
            <DialogDescription>
              This sends a real claim to the payer for {d.member.name ?? "this member"} (
              {d.member.medicaid_id ?? "no ID"}). Type{" "}
              <strong>{PRODUCTION_CONFIRM_PHRASE}</strong> to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirmation</Label>
            <Input id="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!isProductionConfirmed(typed) || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit for real
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border p-3">
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
