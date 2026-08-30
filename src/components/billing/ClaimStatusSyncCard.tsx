import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  getClaimStatusSyncState,
  runClaimStatusSyncNow,
  type ClaimStatusSyncState,
} from "@/lib/claimStatusSync.functions";

type EnqueueResult = {
  ok: boolean;
  queued: number;
  alreadyRunning: number;
  reason?: string;
};

/**
 * Read-only claim status checker: runs on its own schedule and can be kicked
 * manually. It never submits anything — it only reads the portal's current
 * status and updates our record when they differ.
 */
export function ClaimStatusSyncCard() {
  const stateFn = useServerFn(getClaimStatusSyncState);
  const runFn = useServerFn(runClaimStatusSyncNow);
  const qc = useQueryClient();

  const state = useQuery({
    queryKey: ["claim_status_sync_state"],
    queryFn: () => stateFn() as Promise<ClaimStatusSyncState>,
    retry: false,
    // Work happens in the background scheduler, so keep the card live.
    refetchInterval: 15_000,
  });

  const run = useMutation({
    mutationFn: () => runFn({ data: {} as never }) as Promise<EnqueueResult>,
    onSuccess: (r) => {
      if (!r.ok) toast.warning(r.reason ?? "Could not queue the status checks.");
      else if (r.queued > 0)
        toast.success(
          `${r.queued} claim(s) queued — results appear here as the checker works through them.` +
            (r.alreadyRunning ? ` ${r.alreadyRunning} already running.` : ""),
        );
      else if (r.alreadyRunning > 0) toast.info(`${r.alreadyRunning} claim(s) are already being checked.`);
      else toast.info("No open claims to check right now.");
      void qc.invalidateQueries({ queryKey: ["claim_status_sync_state"] });
      void qc.invalidateQueries({ queryKey: ["claims_history"] });
      void qc.invalidateQueries({ queryKey: ["billing_list"] });
      void qc.invalidateQueries({ queryKey: ["company-earnings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not queue status checks"),
  });

  const last = state.data?.last_result;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/60 p-3">
      <div className="min-w-[220px] space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Claim status checking
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            read-only · never submits
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Looks up already-submitted claims and records Paid / Denied. Separate from submission
          automation — this keeps running even when new submissions are paused.
        </p>
        <p className="text-xs text-muted-foreground">
          {state.data?.paused
            ? `Status checking paused — ${state.data.pause_reason ?? "resume it to continue checking."}`
            : `Runs on its own schedule. ${state.data?.due_now ?? 0} open claim(s) tracked.`}
        </p>
        <p className="text-xs text-muted-foreground">
          {state.data?.last_run_at
            ? `Last run ${formatDateTime(state.data.last_run_at)}${
                last ? ` — ${last.checked ?? 0} checked, ${last.changed ?? 0} updated` : ""
              }`
            : "Not run yet."}
        </p>
        <p className="text-xs text-muted-foreground">
          {state.data?.last_success_at
            ? `Last successful portal answer ${formatDateTime(state.data.last_success_at)}.`
            : "No portal answer recorded yet."}
          {(state.data?.retrying_now ?? 0) > 0
            ? ` ${state.data?.retrying_now} claim(s) waiting on a re-check after a checker timeout — confirmation numbers are untouched.`
            : ""}
        </p>
        {state.data?.submissions_paused && (
          <p className="text-xs font-medium text-warning">
            New submissions are paused
            {state.data.submissions_pause_reason
              ? ` — ${state.data.submissions_pause_reason}`
              : "."}{" "}
            Status checking is unaffected.
          </p>
        )}

      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={run.isPending || state.data?.paused}
        onClick={() => run.mutate()}
      >
        {run.isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
        )}
        Check statuses now
      </Button>
    </div>
  );
}
