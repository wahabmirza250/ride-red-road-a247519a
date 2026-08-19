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

type SyncRun = {
  ok: boolean;
  ran: boolean;
  reason?: string;
  checked: number;
  changed: number;
  unchanged: number;
  skipped: number;
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
  });

  const run = useMutation({
    mutationFn: () => runFn({ data: {} as never }) as Promise<SyncRun>,
    onSuccess: (r) => {
      if (!r.ran) toast.info(r.reason ?? "Nothing to check right now.");
      else if (r.changed > 0)
        toast.success(`${r.changed} claim status${r.changed === 1 ? "" : "es"} updated from the portal.`);
      else if (r.checked > 0) toast.success(`${r.checked} claim(s) checked — all already up to date.`);
      else toast.warning(r.reason ?? "No status could be read; nothing was changed.");
      void qc.invalidateQueries({ queryKey: ["claim_status_sync_state"] });
      void qc.invalidateQueries({ queryKey: ["claims_history"] });
      void qc.invalidateQueries({ queryKey: ["billing_list"] });
      void qc.invalidateQueries({ queryKey: ["company-earnings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Status check failed"),
  });

  const last = state.data?.last_result;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/60 p-3">
      <div className="min-w-[220px] space-y-0.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Automatic claim status check
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            read-only
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {state.data?.paused
            ? `Paused — ${state.data.pause_reason ?? "resume it to continue checking."}`
            : `Runs on its own schedule. ${state.data?.due_now ?? 0} open claim(s) tracked.`}
        </p>
        <p className="text-xs text-muted-foreground">
          {state.data?.last_run_at
            ? `Last run ${formatDateTime(state.data.last_run_at)}${
                last ? ` — ${last.checked ?? 0} checked, ${last.changed ?? 0} updated` : ""
              }`
            : "Not run yet."}
        </p>
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
