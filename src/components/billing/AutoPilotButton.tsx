import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Rocket, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getAutoPilotStatus,
  startAutoPilotRun,
  stopAutoPilotRun,
} from "@/lib/autoPilot.functions";
import { autoPilotLabel } from "@/lib/autoPilot";

/**
 * One button beside the billing stages: press it and every eligible bill is
 * sent through the normal safe submit path in bounded waves until the day is
 * done. Nothing to babysit, no filters, no per-wave clicking.
 *
 * Stopping only stops feeding NEW bills — anything already at the portal keeps
 * going and is never cancelled.
 */
export function AutoPilotButton({
  selectedIds,
  resubmissionIds,
}: {
  selectedIds?: string[];
  /** Explicitly selected CORRECTED resubmissions from Ready to Submit. */
  resubmissionIds?: string[];
}) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getAutoPilotStatus);
  const startFn = useServerFn(startAutoPilotRun);
  const stopFn = useServerFn(stopAutoPilotRun);


  const { data } = useQuery({
    queryKey: ["auto_pilot_status"],
    queryFn: () => statusFn() as any,
    refetchInterval: (q: any) => (q.state.data?.running ? 8000 : 30000),
  });

  const s = (data ?? {}) as any;
  const running = Boolean(s.running);
  const remaining = Number(s.remaining ?? 0);
  const inFlight = Number(s.inFlight ?? 0);
  const enqueued = Number(s.enqueued ?? 0);
  const label = autoPilotLabel({ running, remaining, inFlight, enqueued });

  const correctedCount = resubmissionIds?.length ?? 0;
  /** What Auto Pilot would send right now: ready bills + picked corrections. */
  const totalRemaining = remaining + correctedCount;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["auto_pilot_status"] });
    void qc.invalidateQueries({ queryKey: ["billing_list"] });
    void qc.invalidateQueries({ queryKey: ["billing_counts"] });
    void qc.invalidateQueries({ queryKey: ["ready_resubmissions"] });
    void qc.invalidateQueries({ queryKey: ["denied_claims"] });
  };

  const start = useMutation({
    mutationFn: () =>
      startFn({
        data: {
          ...(selectedIds?.length ? { ids: selectedIds } : {}),
          ...(correctedCount ? { resubmission_ids: resubmissionIds } : {}),
        },
      }) as any,
    onSuccess: (r: any) => {
      const corrected = Number(r?.corrected_queued ?? 0);
      toast.success(
        `Auto Pilot started — ${r?.requested ?? 0} bill(s) queued up, ${r?.fed ?? 0} sending now.` +
          (corrected ? ` Includes ${corrected} corrected resubmission(s).` : "") +
          " The rest continue automatically.",
      );
      for (const s of (r?.corrected_skipped ?? []) as any[])
        toast.warning(`Corrected claim not sent: ${s.reason}`);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start Auto Pilot"),
  });


  const stop = useMutation({
    mutationFn: () => stopFn() as any,
    onSuccess: () => {
      toast.message("Auto Pilot stopped — bills already at the portal keep running.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not stop Auto Pilot"),
  });

  const busy = start.isPending || stop.isPending;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[11px] text-muted-foreground xl:inline">{label}</span>
      {running ? (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={busy}
          onClick={() => stop.mutate()}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Square className="mr-1 h-3.5 w-3.5" />
          )}
          Stop Auto Pilot
        </Button>
      ) : (
        <Button
          size="sm"
          className={cn("rounded-full")}
          disabled={busy || totalRemaining === 0}
          onClick={() => start.mutate()}
          title={
            correctedCount
              ? `Send ${correctedCount} corrected resubmission(s)${
                  selectedIds?.length ? ` and ${selectedIds.length} selected bill(s)` : ""
                } automatically`
              : selectedIds?.length
                ? `Send the ${selectedIds.length} selected bill(s) automatically`
                : "Send every ready bill automatically"
          }
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Rocket className="mr-1 h-3.5 w-3.5" />
          )}
          Auto Pilot{totalRemaining > 0 ? ` (${totalRemaining})` : ""}
        </Button>

      )}
    </div>
  );
}
