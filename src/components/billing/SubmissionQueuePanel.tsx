import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PauseCircle,
  PlayCircle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import {
  getSubmissionQueueState,
  setSubmissionQueuePaused,
  type SubmissionQueueState,
} from "@/lib/submissionQueue.functions";
import {
  ageLabel,
  deriveQueueHealth,
  durationLabel,
  totalsFromState,
} from "@/lib/submissionQueueHealth";

/**
 * SUBMISSION AUTOMATION panel — the ops surface for sending bills to the
 * HCPF portal. Deliberately worded so it can never be mistaken for the
 * read-only Claim Status Sync card: pausing here stops NEW submissions only,
 * while status checking and reconciliation keep running.
 */
export function SubmissionQueuePanel() {
  const stateFn = useServerFn(getSubmissionQueueState);
  const pauseFn = useServerFn(setSubmissionQueuePaused);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const state = useQuery({
    queryKey: ["submission_queue_state"],
    queryFn: () => stateFn({ data: {} as never }) as Promise<SubmissionQueueState>,
    retry: false,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const pause = useMutation({
    mutationFn: (v: { paused: boolean; reason?: string }) => pauseFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.paused
          ? "New portal submissions paused. Status checking keeps running."
          : "Portal submissions resumed.",
      );
      setPauseOpen(false);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["submission_queue_state"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change the pause state"),
  });

  const health = deriveQueueHealth(state.data);
  const t = totalsFromState(state.data);
  const limits = state.data?.limits;

  const tone =
    health.level === "paused"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
      : health.level === "warning"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";

  const HealthIcon =
    health.level === "paused" ? PauseCircle : health.level === "warning" ? AlertTriangle : CheckCircle2;

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-3 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[220px] space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Send className="h-4 w-4 text-muted-foreground" />
            Submission automation
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                tone,
              )}
            >
              <HealthIcon className="h-3 w-3" />
              {health.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Sends approved bills to the state portal.{" "}
            {state.data?.paused
              ? `Paused — ${state.data.pause_reason ?? "resume to start sending again."} Claim status checking is unaffected.`
              : "Runs in the background; pausing here stops new submissions only."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {state.data?.paused ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pause.isPending}
              onClick={() => pause.mutate({ paused: false })}
            >
              {pause.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="mr-1 h-3.5 w-3.5" />
              )}
              Resume new submissions
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setPauseOpen(true)}>
              <PauseCircle className="mr-1 h-3.5 w-3.5" />
              Pause new submissions
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle queue details"
          >
            <Activity className="mr-1 h-3.5 w-3.5" />
            Details
            <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Queued" value={t.queued} />
        <Stat label="Processing" value={t.processing} />
        <Stat label="Retrying" value={t.retrying} />
        <Stat label="Needs attention" value={t.needsAttention} warn={t.needsAttention > 0} />
        <Stat label="Submitted (1h)" value={t.submittedLastHour} />
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Oldest queued" value={ageLabel(t.oldestQueuedAt)} />
            <Detail label="Average submit time" value={durationLabel(t.avgSubmitMs)} />
            <Detail
              label="Scheduler last run"
              value={state.data?.last_run_at ? formatDateTime(state.data.last_run_at) : "Not run yet"}
            />
            <Detail label="Active worker leases" value={String(t.leased)} />
            <Detail label="Stale locks" value={String(t.staleLocks)} />
            <Detail
              label="Concurrency limits"
              value={
                limits
                  ? `${limits.per_company}/company · ${limits.global} overall`
                  : "—"
              }
            />
          </div>

          {health.issues.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              {health.issues.map((i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {i}
                </li>
              ))}
            </ul>
          )}

          {state.data && state.data.metrics.length > 1 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Company</th>
                    <th className="py-1 pr-3 font-medium">Queued</th>
                    <th className="py-1 pr-3 font-medium">Processing</th>
                    <th className="py-1 pr-3 font-medium">Needs attention</th>
                    <th className="py-1 font-medium">Submitted (1h)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {state.data.metrics.map((m) => (
                    <tr key={m.company_id ?? m.company_name ?? "—"}>
                      <td className="py-1 pr-3">{m.company_name ?? "—"}</td>
                      <td className="py-1 pr-3 tabular-nums">{m.queued ?? 0}</td>
                      <td className="py-1 pr-3 tabular-nums">{m.processing ?? 0}</td>
                      <td className="py-1 pr-3 tabular-nums">{m.needs_attention ?? 0}</td>
                      <td className="py-1 tabular-nums">{m.submitted_last_hour ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={pauseOpen} onOpenChange={(v) => !pause.isPending && setPauseOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause new portal submissions</DialogTitle>
            <DialogDescription>
              This stops NEW bills being sent to the state portal. Claim status checking and
              reconciliation of already-submitted claims keep running normally.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="pause-reason" className="text-xs font-medium">
              Reason (shown to the billing team)
            </label>
            <Input
              id="pause-reason"
              value={reason}
              maxLength={300}
              placeholder="e.g. Portal maintenance window"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPauseOpen(false)} disabled={pause.isPending}>
              Cancel
            </Button>
            <Button
              disabled={pause.isPending || reason.trim().length < 3}
              onClick={() => pause.mutate({ paused: true, reason: reason.trim() })}
            >
              {pause.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Pause submissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-lg font-semibold tabular-nums",
          warn && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
