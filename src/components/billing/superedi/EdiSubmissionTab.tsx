/**
 * EDI Submission — bulk only.
 *
 *   selected rows → ONE submission batch → ONE 837P file → explicit upload.
 *
 * Documented endpoints only (`/submission-batches/`,
 * `/submission-batches/{id}/add-claim/`, `/edi-files/generate-837p/`,
 * `/edi-files/{id}/upload/`). Claims the backend did not call `ready` are
 * excluded with their reason and never block the ready ones. TEST is the
 * default; PRODUCTION needs company clearance AND a typed confirmation.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  FileCog,
  Loader2,
  Rocket,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
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
import { batchCounts, partitionForBatch } from "@/lib/ediBulk";
import { ediBuildBatch, ediUploadFileToTradingPartner } from "@/lib/ediBulk.functions";
import type { EdiBatchBuildResult } from "@/lib/ediBulk.functions";
import { PRODUCTION_CONFIRM_PHRASE, isProductionConfirmed, type EdiEnvironment } from "@/lib/ediSetup";
import type { EdiWorkRow } from "@/lib/ediTypes";
import { CountChip, Empty, Panel, StatCard, moneyText } from "./ediUi";

export function EdiSubmissionTab({
  companyId,
  selectedRows,
  environment,
  productionReady,
  onRowsUpdated,
  onOpenReview,
}: {
  companyId: string | null;
  selectedRows: EdiWorkRow[];
  environment: EdiEnvironment;
  /** Company is cleared for live submission (setup complete + production on). */
  productionReady: boolean;
  onRowsUpdated: (rows: EdiWorkRow[]) => void;
  onOpenReview: () => void;
}) {
  const buildFn = useServerFn(ediBuildBatch);
  const uploadFn = useServerFn(ediUploadFileToTradingPartner);

  const [result, setResult] = useState<EdiBatchBuildResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const counts = useMemo(() => batchCounts(selectedRows), [selectedRows]);
  const { ready, excluded } = useMemo(() => partitionForBatch(selectedRows), [selectedRows]);
  const readyCharge = useMemo(
    () =>
      selectedRows
        .filter((r) => ready.some((x) => x.record_id === r.record_id))
        .reduce((sum, r) => sum + r.total_charge, 0),
    [ready, selectedRows],
  );

  // A batch/file already stamped on the selection (idempotent re-entry).
  const existingBatch = useMemo(() => {
    const ids = new Set(selectedRows.map((r) => r.edi_batch_id).filter((v): v is number => !!v));
    return ids.size === 1 ? [...ids][0]! : null;
  }, [selectedRows]);
  const existingFile = useMemo(() => {
    const ids = new Set(selectedRows.map((r) => r.edi_file_id).filter((v): v is number => !!v));
    return ids.size === 1 ? [...ids][0]! : null;
  }, [selectedRows]);

  const batchId = result?.batch_id ?? existingBatch;
  const fileId = result?.file_id ?? existingFile;
  const uploadedIds = result?.included.length
    ? result.included
    : selectedRows.filter((r) => r.edi_file_id === fileId).map((r) => r.record_id);

  const build = useMutation({
    mutationFn: async () => {
      const ids = selectedRows.map((r) => r.record_id);
      return buildFn({ data: { company_id: companyId, record_ids: ids } });
    },
    onSuccess: (res) => {
      setResult(res);
      onRowsUpdated(res.rows);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not build the submission batch"),
  });

  const upload = useMutation({
    mutationFn: async (env: EdiEnvironment) => {
      if (!fileId) throw new Error("Generate the 837P file first");
      return uploadFn({
        data: {
          company_id: companyId,
          file_id: fileId,
          record_ids: uploadedIds,
          environment: env,
          ...(env === "production" ? { confirmation: typed } : {}),
        },
      });
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.message);
        setConfirmOpen(false);
        setTyped("");
      } else {
        toast.error(res.message);
      }
      build.reset();
      void refreshAfterUpload();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  /** Re-reads the rows so the pills reflect the new `uploaded` state. */
  async function refreshAfterUpload() {
    try {
      const res = await buildFn({
        data: { company_id: companyId, record_ids: selectedRows.map((r) => r.record_id) },
      });
      onRowsUpdated(res.rows);
      setResult((prev) => (prev ? { ...prev, rows: res.rows } : prev));
    } catch {
      // The upload already reported its own outcome; a refresh miss is harmless.
    }
  }

  if (!selectedRows.length) {
    return (
      <Empty icon>
        Nothing selected yet. Pick the bills you want to file in{" "}
        <button className="underline underline-offset-2" onClick={onOpenReview}>
          Batch Review
        </button>{" "}
        — every claim the backend called ready goes into one 837P.
      </Empty>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Selected bills" value={counts.selected} />
        <StatCard
          label="Ready for this file"
          value={counts.ready}
          hint={`${moneyText(readyCharge)} total charge`}
        />
        <StatCard label="Excluded" value={counts.excluded} hint="Held back with a reason" />
        <StatCard
          label="Environment"
          value={environment === "production" ? "PRODUCTION" : "TEST"}
          hint={productionReady ? "Company cleared for live filing" : "Live filing not enabled"}
        />
      </div>

      <Panel
        title="Build the 837P"
        action={
          <Badge variant={environment === "production" ? "destructive" : "secondary"}>
            {environment === "production" ? "PRODUCTION" : "TEST"}
          </Badge>
        }
      >
        <ol className="space-y-3">
          <Step index={1} title="Backend validation" done={counts.ready > 0}>
            {counts.ready > 0 ? (
              <>
                {counts.ready} claim{counts.ready === 1 ? "" : "s"} reported <strong>ready</strong>{" "}
                by the EDI backend.
                {counts.excluded > 0 && ` ${counts.excluded} excluded — see the list below.`}
              </>
            ) : (
              <>
                No claim in this selection is ready yet. Run{" "}
                <button className="underline underline-offset-2" onClick={onOpenReview}>
                  Validate All
                </button>{" "}
                in Batch Review first.
              </>
            )}
          </Step>

          <Step index={2} title="Submission batch + 837P file" done={!!batchId && !!fileId}>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="rounded-full"
                disabled={counts.ready === 0 || build.isPending}
                onClick={() => build.mutate()}
              >
                {build.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileCog className="mr-2 h-3.5 w-3.5" />
                )}
                {batchId ? "Rebuild / continue batch" : `Build batch of ${counts.ready}`}
              </Button>
              {batchId ? <CountChip label="batch" value={`#${batchId}`} tone="info" /> : null}
              {fileId ? <CountChip label="837P file" value={`#${fileId}`} tone="info" /> : null}
            </div>
            <p className="mt-2">
              One batch, one file: every ready claim is added to the same submission batch, then a
              single 837P is generated for it. Clicking again reuses the existing batch and file.
            </p>
          </Step>

          <Step
            index={3}
            title="Hand the file to the trading partner"
            done={selectedRows.some((r) => (r.edi_status ?? "") === "uploaded")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={!fileId || upload.isPending}
                onClick={() => upload.mutate("test")}
              >
                {upload.isPending && upload.variables === "test" ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                )}
                Upload TEST file
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="rounded-full"
                disabled={!fileId || !productionReady || upload.isPending}
                title={
                  productionReady
                    ? "Requires a typed confirmation"
                    : "Enable production for this company in Provider Setup first"
                }
                onClick={() => setConfirmOpen(true)}
              >
                <Rocket className="mr-2 h-3.5 w-3.5" />
                Submit to PRODUCTION
              </Button>
            </div>
            <p className="mt-2">
              Nothing leaves RedArt until one of these is clicked. Production stays disabled until
              the company is marked production-capable in Provider Setup.
            </p>
          </Step>
        </ol>
      </Panel>

      {result && (
        <Panel title="Last build result">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Batch" value={result.batch_id ? `#${result.batch_id}` : "—"} />
            <StatCard label="837P file" value={result.file_id ? `#${result.file_id}` : "—"} />
            <StatCard label="Claims included" value={result.included.length} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{result.message}</p>
          {result.failures.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-destructive">
              {result.failures.map((f, i) => (
                <li key={`${f.record_id}-${i}`} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    {rowLabel(selectedRows, f.record_id)}
                    {f.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {excluded.length > 0 && (
        <Panel
          title={`Excluded from this file (${excluded.length})`}
          action={
            <Button size="sm" variant="ghost" className="rounded-full" onClick={onOpenReview}>
              Fix in Batch Review <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          }
        >
          <ul className="divide-y divide-border text-sm">
            {excluded.map((x) => (
              <li key={x.record_id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-foreground">
                  {rowLabel(selectedRows, x.record_id) || "Bill"}
                </span>
                <span className="min-w-0 max-w-[60%] break-words text-right text-muted-foreground">
                  {x.reason}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" /> Confirm production submission
            </DialogTitle>
            <DialogDescription>
              This files {uploadedIds.length} real claim{uploadedIds.length === 1 ? "" : "s"} (
              {moneyText(readyCharge)}) with the payer. Type{" "}
              <strong>{PRODUCTION_CONFIRM_PHRASE}</strong> to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edi-production-confirm">Confirmation</Label>
            <Input
              id="edi-production-confirm"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!isProductionConfirmed(typed) || upload.isPending}
              onClick={() => upload.mutate("production")}
            >
              {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit for real
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function rowLabel(rows: EdiWorkRow[], recordId: string): string {
  const row = rows.find((r) => r.record_id === recordId);
  if (!row) return "";
  return `${row.member_name ?? "Unknown member"} · ${row.service_date?.slice(0, 10) ?? "no date"} — `;
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
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
