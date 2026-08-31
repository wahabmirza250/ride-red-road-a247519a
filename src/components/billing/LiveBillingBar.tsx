import { AlertTriangle, Check, Calculator } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { money, type DraftBilling, type LineConsistency } from "@/lib/resubmissionBilling";

/**
 * Persistent live billing calculation bar. Rendered once, directly under the
 * editor tab list, so it stays visible on Trip, Legs, Service lines, Review and
 * History on both desktop and mobile. Read-only: it never mutates the draft.
 */
export function LiveBillingBar({
  billing,
  consistency,
  onApply,
  canApply,
}: {
  billing: DraftBilling;
  consistency: LineConsistency;
  onApply?: () => void;
  canApply?: boolean;
}) {
  const tripRate = billing.trip_rate;
  const mileRate = billing.mile_rate;

  return (
    <div
      data-testid="live-billing-bar"
      className="sticky top-0 z-20 mx-4 mt-3 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm backdrop-blur sm:mx-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Calculator className="h-3.5 w-3.5" /> Live billing calculation
        </span>

        <Metric label="Trip units" value={String(billing.units)} />
        <Metric
          label="Miles"
          value={String(billing.miles)}
          hint={billing.miles_source === "override" ? "manual override" : "from odometers"}
        />
        <Metric
          label={tripRate ? `Trip charge (${tripRate.procedure_code})` : "Trip charge"}
          value={billing.base_charge == null ? "Rate missing" : money(billing.base_charge)}
          hint={tripRate ? `${billing.units} × ${money(tripRate.rate)}` : "no configured trip rate"}
          missing={billing.base_charge == null}
        />
        <Metric
          label={mileRate ? `Mileage charge (${mileRate.procedure_code})` : "Mileage charge"}
          value={billing.mileage_charge == null ? "Rate missing" : money(billing.mileage_charge)}
          hint={mileRate ? `${billing.miles} × ${money(mileRate.rate)}` : "no configured mile rate"}
          missing={billing.mileage_charge == null}
        />
        {billing.extra_charge > 0 ? (
          <Metric
            label="Other lines"
            value={money(billing.extra_charge)}
            hint={`${billing.extra_lines.length} custom line(s)`}
          />
        ) : null}
        <div className="ml-auto rounded-xl bg-primary/10 px-3 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total claim</div>
          <div className="text-lg font-bold leading-tight">
            {billing.total == null ? "Rate missing" : money(billing.total)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {billing.missing_rates.length === 0 ? (
          <Badge variant="secondary">
            Using configured rate{tripRate ? ` · ${tripRate.procedure_code}` : ""}
            {mileRate ? ` · ${mileRate.procedure_code}` : ""}
          </Badge>
        ) : (
          <Badge variant="destructive">
            Rate missing: {billing.missing_rates.join(" and ")}
            {billing.vehicle_type ? ` for ${billing.vehicle_type.replace(/_/g, " ")}` : ""}
          </Badge>
        )}

        {consistency.checked ? (
          consistency.ok ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Service lines match calculation.
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Service lines differ from the calculation ({consistency.differences.length}).
            </span>
          )
        ) : null}

        {consistency.checked && !consistency.ok && onApply ? (
          <Button size="sm" variant="outline" disabled={!canApply} onClick={onApply}>
            Apply calculated values to service lines
          </Button>
        ) : null}
      </div>

      {consistency.differences.length ? (
        <ul className="mt-1.5 list-disc pl-5 text-[11px] text-amber-600 dark:text-amber-400">
          {consistency.differences.map((d, i) => (
            <li key={`${d.procedure_code}-${d.field}-${i}`}>{d.message}</li>
          ))}
        </ul>
      ) : null}

      {billing.warnings.length ? (
        <ul className="mt-1.5 list-disc pl-5 text-[11px] text-muted-foreground">
          {billing.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`}>{w.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  missing,
}: {
  label: string;
  value: string;
  hint?: string;
  missing?: boolean;
}) {
  return (
    <div className="min-w-[92px]">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${missing ? "text-destructive" : ""}`}>{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
