import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, PauseCircle, Play, RefreshCw, SearchCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  confirmSweepClaim,
  confirmSweepNoClaim,
  getReconcileSweep,
  kickReconcileSweep,
  setReconcileSweepStatus,
  startReconcileSweep,
} from "@/lib/reconcileSweep.functions";
import { friendlyLinkError, money, parseClaimConflict, type PortalClaim } from "@/lib/hcpfSearch";
import { outcomeLabel, sortByPriority, type SweepResultRow } from "@/lib/reconcileSweep";

/**
 * BULK HCPF RECONCILIATION — progress + one-click confirmations.
 *
 * The sweep only searches. Every bill stays in its current tab until the
 * biller confirms here, and no claim id is ever attached automatically.
 */
export function ReconcileSweepCard({ onOpenRecord }: { onOpenRecord?: (id: string) => void }) {
  const qc = useQueryClient();
  const startFn = useServerFn(startReconcileSweep);
  const progressFn = useServerFn(getReconcileSweep);
  const statusFn = useServerFn(setReconcileSweepStatus);
  const kickFn = useServerFn(kickReconcileSweep);
  const linkFn = useServerFn(confirmSweepClaim);
  const noneFn = useServerFn(confirmSweepNoClaim);
  const [expanded, setExpanded] = useState(true);

  const q = useQuery({
    queryKey: ["reconcile_sweep"],
    queryFn: () => progressFn(),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reconcile_sweep"] });
    qc.invalidateQueries({ queryKey: ["billing_list"] });
    qc.invalidateQueries({ queryKey: ["billing_counts"] });
  };

  const start = useMutation({
    mutationFn: () => startFn(),
    onSuccess: (r: any) => {
      toast.success(`Read-only sweep running for ${r?.total ?? 0} bill(s). Nothing is submitted.`);
      invalidate();
    },
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const pauseResume = useMutation({
    mutationFn: (status: "running" | "paused") =>
      statusFn({ data: { sweep_id: q.data!.sweep!.id, status } }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const kick = useMutation({
    mutationFn: () => kickFn(),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const link = useMutation({
    mutationFn: (v: { id: string; claim: string }) =>
      linkFn({ data: { id: v.id, claim_number: v.claim, acknowledged: true } }),
    onSuccess: () => {
      toast.success("Recorded — the claim number is attached to that bill. Nothing was submitted.");
      invalidate();
    },
    onError: (e: any) => {
      const c = parseClaimConflict(e);
      toast.error(
        c
          ? `Claim ${c.claim} is already linked to another RedArt bill — nothing was written.`
          : friendlyLinkError(e),
      );
    },
  });

  const none = useMutation({
    mutationFn: (id: string) => noneFn({ data: { id, acknowledged: true } }),
    onSuccess: () => {
      toast.success("Recorded — verified as not submitted. It is NOT queued or sent.");
      invalidate();
    },
    onError: (e: any) => toast.error(friendlyLinkError(e)),
  });

  const busy = link.isPending || none.isPending || start.isPending;
  const sweep = q.data?.sweep ?? null;
  const p = q.data?.progress;
  const rows = sortByPriority((q.data?.rows ?? []) as SweepResultRow[]);
  const pct = p && p.total ? Math.round(((p.total - p.remaining) / p.total) * 100) : 0;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SearchCheck className="h-4 w-4" /> Bulk HCPF reconciliation (read-only)
          </div>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Searches HCPF for every bill here that has no claim number, one portal session per
            account at a time. Nothing is submitted, resubmitted or moved — each bill stays in this
            tab until you confirm the result below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!sweep || sweep.status === "done" ? (
            <Button size="sm" disabled={busy} onClick={() => start.mutate()}>
              {start.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              Start sweep
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => start.mutate()} disabled={busy}>
                <RefreshCw className="mr-1 h-4 w-4" /> Re-scan for new bills
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => pauseResume.mutate(sweep.status === "running" ? "paused" : "running")}
              >
                {sweep.status === "running" ? (
                  <>
                    <PauseCircle className="mr-1 h-4 w-4" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="mr-1 h-4 w-4" /> Resume
                  </>
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => kick.mutate()} disabled={kick.isPending}>
                {kick.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Run now
              </Button>
            </>
          )}
        </div>
      </div>

      {p && p.total > 0 && (
        <>
          <Progress value={pct} className="h-2" />
          <div className="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-7">
            <Stat label="Total" value={p.total} />
            <Stat label="Searched" value={p.searched} />
            <Stat label="1 match" value={p.single} />
            <Stat label="No result" value={p.none} />
            <Stat label="Multiple" value={p.multiple} />
            <Stat label="Errors" value={p.errors} />
            <Stat label="Remaining" value={p.remaining} />
          </div>
        </>
      )}

      {p && p.total === 0 && (
        <p className="text-xs text-muted-foreground">
          No bills in this stage are missing a claim number.
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <button
            className="text-xs font-medium underline underline-offset-2"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide results" : `Show ${rows.length} result(s)`}
          </button>
          {expanded &&
            rows.slice(0, 100).map((r) => (
              <SweepRow
                key={r.id}
                row={r}
                busy={busy}
                onOpen={onOpenRecord}
                onLink={(claim) => link.mutate({ id: r.billing_record_id, claim })}
                onNoClaim={() => none.mutate(r.billing_record_id)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function SweepRow({
  row,
  busy,
  onLink,
  onNoClaim,
  onOpen,
}: {
  row: SweepResultRow;
  busy: boolean;
  onLink: (claim: string) => void;
  onNoClaim: () => void;
  onOpen?: (id: string) => void;
}) {
  const candidates: PortalClaim[] = row.candidates ?? [];
  const single = row.outcome === "single" ? candidates[0] : null;
  return (
    <div className="rounded-xl border border-border bg-background p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono">{row.member_id ?? "—"}</span>
          <span className="font-mono">{row.service_date ?? "—"}</span>
          <span className="text-muted-foreground">{outcomeLabel(row.outcome)}</span>
          {row.confirmed_at && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">
              Confirmed
            </span>
          )}
        </div>
        {onOpen && (
          <Button size="sm" variant="ghost" onClick={() => onOpen(row.billing_record_id)}>
            Open bill
          </Button>
        )}
      </div>

      {row.outcome === "error" && row.error && (
        <p className="mt-1 flex items-start gap-1 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {row.error}
        </p>
      )}

      {!row.confirmed_at && row.outcome === "none" && (
        <div className="mt-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={onNoClaim}>
            <Check className="mr-1 h-4 w-4" /> Confirm: no claim at HCPF
          </Button>
        </div>
      )}

      {!row.confirmed_at && single && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{single.claim_id}</span>
          <span>Status: {single.status ?? "—"}</span>
          <span>Paid: {money(single.paid_amount)}</span>
          <Button size="sm" disabled={busy} onClick={() => onLink(single.claim_id)}>
            <Check className="mr-1 h-4 w-4" /> Confirm this claim
          </Button>
        </div>
      )}

      {!row.confirmed_at && row.outcome === "multiple" && (
        <div className="mt-2 space-y-1">
          {candidates.map((c) => (
            <div key={c.claim_id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold">{c.claim_id}</span>
              <span>Status: {c.status ?? "—"}</span>
              <span>DOS: {c.service_date ?? row.service_date ?? "—"}</span>
              <span>Paid: {money(c.paid_amount)}</span>
              {c.linked ? (
                <span className="flex items-center gap-1 text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" /> already linked to another bill
                </span>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onLink(c.claim_id)}>
                  Confirm this claim
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
