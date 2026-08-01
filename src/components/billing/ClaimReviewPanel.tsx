import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ClipboardCheck, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelClaimReview, confirmAndSubmitClaim } from "@/lib/billing.functions";
import { formatMoney, normalizeCapturedClaim, type CapturedClaim } from "@/lib/claimReview";
import { friendlyErrorMessage } from "@/lib/errorMessage";
import { formatDateTime } from "@/lib/format";

/**
 * PASS 1 result review. Shows the claim exactly as the robot read it back off
 * the HCPF portal, with Confirm & Submit (starts PASS 2) and Cancel (no-op).
 */
export function ClaimReviewPanel({
  recordId,
  captured,
  capturedAt,
  onDone,
}: {
  recordId: string;
  captured: unknown;
  capturedAt?: string | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const confirmFn = useServerFn(confirmAndSubmitClaim);
  const cancelFn = useServerFn(cancelClaimReview);

  const claim: CapturedClaim | null = normalizeCapturedClaim(captured);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["billing_list"] });
    qc.invalidateQueries({ queryKey: ["billing_detail", recordId] });
    qc.invalidateQueries({ queryKey: ["billing_counts"] });
  };

  const confirm = useMutation({
    mutationFn: () => confirmFn({ data: { id: recordId } }),
    onSuccess: () => {
      toast.success("Submitting to the portal — the confirmation number will be saved automatically.");
      invalidate();
      onDone?.();
    },
    onError: (e: unknown) =>
      toast.error(friendlyErrorMessage(e, "Could not start the real submission")),
  });

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { id: recordId } }),
    onSuccess: () => {
      toast.message("Cancelled — nothing was submitted and no portal session was opened.");
      invalidate();
      onDone?.();
    },
    onError: (e: unknown) => toast.error(friendlyErrorMessage(e, "Could not cancel")),
  });

  const busy = confirm.isPending || cancel.isPending;

  if (!claim) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        The automation did not return readable claim data for this trip. Review the claim in the
        portal before submitting.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/60 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold">Review &amp; confirm claim</div>
          <div className="text-xs text-muted-foreground">
            Read back from the HCPF portal
            {capturedAt ? ` · ${formatDateTime(capturedAt)}` : ""} · session closed
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
        <Field label="Member ID" value={claim.member_id || "—"} mono />
        <Field label="Member name" value={claim.member_name || "—"} />
        <Field label="Diagnosis code" value={claim.diagnosis_code || "—"} mono />
      </dl>

      <div className="px-4 pb-2">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Service lines
        </div>
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Procedure</th>
                <th className="px-3 py-2 text-left font-medium">Place of service</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-right font-medium">Charge</th>
              </tr>
            </thead>
            <tbody>
              {claim.service_lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">
                    No service lines were returned
                  </td>
                </tr>
              ) : (
                claim.service_lines.map((line, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono">{line.procedure_code || "—"}</td>
                    <td className="px-3 py-2">{line.place_of_service || "—"}</td>
                    <td className="px-3 py-2 text-right">{line.units ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(line.charge_amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Total charged
                </td>
                <td className="px-3 py-2 text-right text-base font-semibold">
                  {formatMoney(claim.total_charged_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 sm:flex-row">
        <Button className="flex-1" disabled={busy} onClick={() => confirm.mutate()}>
          {confirm.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-1 h-4 w-4" />
          )}
          Confirm &amp; Submit
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={busy}
          onClick={() => cancel.mutate()}
        >
          {cancel.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <X className="mr-1 h-4 w-4" />
          )}
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
