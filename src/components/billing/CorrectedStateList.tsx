/**
 * CORRECTED RESUBMISSIONS OUTSIDE READY.
 *
 * The same corrected copies, rendered in the stage that matches their real
 * lifecycle state:
 *   processing — claimed by Auto Pilot and working at the portal. No actions.
 *   failed     — definitely never sent. Explicit owner Review / Retry only.
 *   submitted  — a NEW portal claim exists; the original claim is shown beside
 *                it and is never reused.
 *
 * Nothing here can submit anything: retry only moves a failed copy back to
 * Ready to Submit, where the owner still has to start Auto Pilot.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";
import { formatDate } from "@/lib/format";
import { money } from "@/lib/resubmissionBilling";
import type { CorrectedReadyCandidate } from "@/lib/readyResubmissions";
import { retryFailedResubmission } from "@/lib/readyResubmissions.functions";

export function CorrectedStateList({
  rows,
  stage,
  onOpen,
}: {
  rows: CorrectedReadyCandidate[];
  stage: "processing" | "failed" | "submitted";
  onOpen?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const retryFn = useServerFn(retryFailedResubmission);
  const [busy, setBusy] = useState<string | null>(null);

  const retry = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }) as Promise<{ moved: boolean; reason: string }>,
    onSuccess: (res) => {
      if (res.moved) toast.success("Moved back to Ready to Submit. Nothing was sent.");
      else toast.message(res.reason || "Nothing to move.");
      qc.invalidateQueries({ queryKey: ["ready_resubmissions"] });
      qc.invalidateQueries({ queryKey: ["corrected_stage"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
    onSettled: () => setBusy(null),
  });

  if (!rows.length) return null;

  const banner =
    stage === "processing"
      ? "working at the portal right now — they cannot be selected or resent."
      : stage === "failed"
        ? "were NOT sent to the portal. Review the reason, then move them back to Ready to Submit."
        : "were accepted by the portal as NEW claims.";

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">{rows.length}</strong> corrected resubmission
        {rows.length === 1 ? "" : "s"} {banner}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.id}
            className="bill-card flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.passenger_name ?? "—"}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {r.medicaid_id ?? "—"}
                </div>
              </div>
              <Badge className="shrink-0 rounded-full bg-emerald-600 text-white hover:bg-emerald-600">
                Corrected resubmission
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Original claim</dt>
              <dd className="text-right font-mono">{r.original_claim_number ?? "—"}</dd>
              {stage === "submitted" && (
                <>
                  <dt className="text-muted-foreground">New claim</dt>
                  <dd className="text-right font-mono font-semibold">
                    {r.resubmission_claim_number ?? "—"}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Corrected date</dt>
              <dd className="text-right font-medium">
                {r.service_date ? formatDate(r.service_date) : "—"}
              </dd>
              <dt className="text-muted-foreground">Corrected amount</dt>
              <dd className="text-right font-semibold">{money(r.total_amount)}</dd>
            </dl>

            {stage === "processing" && (
              <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Sending to the portal
              </div>
            )}

            {stage === "failed" && (
              <>
                <p className="rounded-lg bg-destructive/10 p-2 text-[11px] text-destructive">
                  {r.failure_reason ?? "The corrected claim was not sent to the portal."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {onOpen && (
                    <Button size="sm" variant="outline" onClick={() => onOpen(r.id)}>
                      Review
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => {
                      setBusy(r.id);
                      retry.mutate(r.id);
                    }}
                  >
                    {busy === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Move back to Ready
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
