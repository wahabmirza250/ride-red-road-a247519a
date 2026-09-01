/**
 * EDI status panel for a single billing record.
 *
 * Only rendered with real data: if the record has no `edi_claim_id` we show a
 * neutral "not linked" note and no actions. Nothing here submits to HCPF and
 * nothing here duplicates X12/HCPF rules — the EDI backend owns all of that.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShieldCheck, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EDI_TEST_LABEL,
  ediClaimId,
  ediIsValid,
  ediStatusTone,
  ediValidationIssues,
  hasEdiClaim,
  type EdiClaimRef,
} from "@/lib/edi";
import { getEdiClaimStatus, validateEdiClaim } from "@/lib/edi.functions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "bg-destructive/10 text-destructive",
  idle: "bg-muted text-muted-foreground",
};

export function EdiStatusBadge({ status }: { status?: string | null }) {
  const tone = ediStatusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASS[tone],
      )}
    >
      <PlugZap className="h-3 w-3" />
      {EDI_TEST_LABEL}
      {status ? ` · ${status}` : ""}
    </span>
  );
}

export function EdiStatusPanel({ record }: { record: EdiClaimRef | null | undefined }) {
  const claimId = ediClaimId(record);
  const [validation, setValidation] = useState<unknown>(record?.edi_validation ?? null);
  const [status, setStatus] = useState<string | null>(record?.edi_status ?? null);
  const [syncedAt, setSyncedAt] = useState<string | null>(record?.edi_last_sync_at ?? null);
  const [busy, setBusy] = useState<"validate" | "status" | null>(null);

  const runValidate = async () => {
    if (!claimId) return;
    setBusy("validate");
    const res = await validateEdiClaim(claimId);
    setBusy(null);
    if (!res.ok) {
      toast.error(`EDI validation failed — ${res.error}`);
      return;
    }
    setValidation(res.data);
    setSyncedAt(new Date().toISOString());
    const valid = ediIsValid(res.data);
    if (valid === false) toast.warning("Not ready — EDI backend reported validation errors");
    else if (valid === true) toast.success("Ready for 837P generation");
    else toast.success("EDI validation complete");
  };

  const runStatus = async () => {
    if (!claimId) return;
    setBusy("status");
    const res = await getEdiClaimStatus(claimId);
    setBusy(null);
    if (!res.ok) {
      toast.error(`Could not refresh EDI status — ${res.error}`);
      return;
    }
    const next = (res.data as { status?: string } | null)?.status ?? null;
    setStatus(next);
    setSyncedAt(new Date().toISOString());
    toast.success(next ? `EDI status: ${next}` : "EDI status refreshed");
  };

  const issues = ediValidationIssues(validation);

  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          EDI backend
          <EdiStatusBadge status={status} />
        </div>
        {syncedAt && (
          <span className="text-muted-foreground">Last sync {formatDateTime(syncedAt)}</span>
        )}
      </div>

      {!hasEdiClaim(record) ? (
        <p className="mt-2 text-muted-foreground">
          Not linked to an EDI claim yet. The existing robot submission path is still the
          active route for this bill.
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 text-muted-foreground">
            <div>
              Claim <span className="font-medium text-foreground">#{claimId}</span>
            </div>
            {record?.edi_batch_id ? (
              <div>
                Batch <span className="font-medium text-foreground">#{record.edi_batch_id}</span>
              </div>
            ) : null}
            {record?.edi_file_id ? (
              <div>
                File <span className="font-medium text-foreground">#{record.edi_file_id}</span>
              </div>
            ) : null}
          </div>

          {record?.edi_last_error && (
            <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-destructive">
              {record.edi_last_error}
            </p>
          )}

          {issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {issues.slice(0, 8).map((i, idx) => (
                <li
                  key={idx}
                  className={cn(
                    "rounded-lg p-2",
                    i.severity === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {i.code ? <strong>{i.code}: </strong> : null}
                  {i.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={runValidate}>
              {busy === "validate" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-1 h-4 w-4" />
              )}
              Validate EDI
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={runStatus}>
              {busy === "status" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Refresh EDI Status
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {EDI_TEST_LABEL} — read-only checks against the EDI backend. Nothing is submitted
            to HCPF from here.
          </p>
        </>
      )}
    </div>
  );
}
