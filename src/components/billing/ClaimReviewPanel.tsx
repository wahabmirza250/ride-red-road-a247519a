import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ClipboardCheck, Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelClaimReview, confirmAndSubmitClaim } from "@/lib/billing.functions";
import { listBillingRateSettings, type BillingRateSetting } from "@/lib/billingRates.functions";
import { formatMoney, normalizeCapturedClaim, type CapturedClaim, type CapturedServiceLine } from "@/lib/claimReview";
import { friendlyErrorMessage } from "@/lib/errorMessage";
import { formatDateTime } from "@/lib/format";

/**
 * TEMPORARY SAFETY GATE — real portal submissions (PASS 2 / confirm_submit)
 * are paused while billing is being settled. Flip this to `false` to re-enable
 * the "Confirm & Submit" button. No submission code was removed.
 */
const REAL_SUBMISSIONS_PAUSED = true;
/** Phrase an admin must type to unlock the button when the pause is lifted. */
const UNLOCK_PHRASE = "SUBMIT";

/**
 * PASS 1 result review. Shows the claim exactly as the robot read it back off
 * the HCPF portal, laid out like the portal's own "Confirm Professional Claim"
 * page, with a per-line calculation breakdown.
 */

export function ClaimReviewPanel({
  recordId,
  captured,
  capturedAt,
  vehicleType,
  onDone,
}: {
  recordId: string;
  captured: unknown;
  capturedAt?: string | null;
  vehicleType?: string | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const confirmFn = useServerFn(confirmAndSubmitClaim);
  const cancelFn = useServerFn(cancelClaimReview);
  const listRates = useServerFn(listBillingRateSettings);

  const claim: CapturedClaim | null = normalizeCapturedClaim(captured);

  const ratesQuery = useQuery({
    queryKey: ["billing_rate_settings"],
    queryFn: () => listRates(),
    staleTime: 5 * 60_000,
  });
  const rates: BillingRateSetting[] = (ratesQuery.data as BillingRateSetting[]) ?? [];

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

      <SectionBar tone="blue">Patient Information</SectionBar>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
        <Field label="Member ID" value={claim.member_id || "—"} mono />
        <Field label="Member name" value={claim.member_name || "—"} />
        <Field label="Diagnosis code" value={claim.diagnosis_code || "—"} mono />
      </dl>

      <SectionBar tone="blue">Service Details</SectionBar>
      <div className="px-4 py-4">
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Procedure Code</th>
                <th className="px-3 py-2 text-left font-medium">Place of Service</th>
                <th className="px-3 py-2 text-right font-medium">Charge Amount</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
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
                  <ServiceLineRows key={i} line={line} rates={rates} vehicleType={vehicleType} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SectionBar tone="green">Total</SectionBar>
      <div className="flex items-baseline justify-between px-4 py-4">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Total charged amount
        </span>
        <span className="text-2xl font-semibold tabular-nums">
          {formatMoney(claim.total_charged_amount)}
        </span>
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

function ServiceLineRows({
  line,
  rates,
  vehicleType,
}: {
  line: CapturedServiceLine;
  rates: BillingRateSetting[];
  vehicleType?: string | null;
}) {
  return (
    <>
      <tr className="border-t border-border/60">
        <td className="px-3 py-2 font-mono">{line.procedure_code || "—"}</td>
        <td className="px-3 py-2">{line.place_of_service || "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.charge_amount)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatUnits(line.units)}</td>
      </tr>
      <tr className="border-t border-border/30 bg-muted/20">
        <td colSpan={4} className="px-3 pb-2 pt-1 text-xs text-muted-foreground">
          {explainLine(line, rates, vehicleType)}
        </td>
      </tr>
    </>
  );
}

function matchRate(
  line: CapturedServiceLine,
  rates: BillingRateSetting[],
  vehicleType?: string | null,
): BillingRateSetting | undefined {
  const code = line.procedure_code?.trim().toUpperCase();
  const byVehicle = vehicleType ? rates.filter((r) => r.vehicle_type === vehicleType) : rates;
  const pool = byVehicle.length ? byVehicle : rates;
  return pool.find((r) => r.procedure_code?.trim().toUpperCase() === code);
}

function isMileageLine(line: CapturedServiceLine, rate?: BillingRateSetting) {
  if (rate) return rate.unit_type === "mile";
  return (line.units ?? 0) > 4;
}

function explainLine(
  line: CapturedServiceLine,
  rates: BillingRateSetting[],
  vehicleType?: string | null,
): string {
  const units = line.units;
  const charge = line.charge_amount;
  if (units == null || charge == null || units === 0) {
    return "Rate breakdown unavailable for this line.";
  }
  const rate = matchRate(line, rates, vehicleType);
  const perUnit = rate ? Number(rate.charge_amount) : charge / units;
  const mileage = isMileageLine(line, rate);

  if (mileage) {
    return `Mileage: ${formatUnits(units)} miles × ${money(perUnit)}/mile = ${money(charge)}`;
  }
  const kind = units === 2 ? " (round trip)" : units === 1 ? " (one way)" : "";
  return `Trip charge: ${formatUnits(units)} unit(s)${kind} × ${money(perUnit)}/unit = ${money(charge)}`;
}

function money(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatUnits(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

function SectionBar({ children, tone }: { children: React.ReactNode; tone: "blue" | "green" }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
      : "border-primary/40 bg-primary/10 text-primary";
  return (
    <div
      className={`border-y px-4 py-2 text-xs font-semibold uppercase tracking-wider ${toneClass}`}
    >
      {children}
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
