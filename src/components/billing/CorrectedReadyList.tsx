/**
 * READY TO SUBMIT — corrected resubmission cards.
 *
 * These are denied claims the biller already corrected and moved to Ready.
 * They live in `claim_resubmissions` (status `queued` = ready, NOT sending),
 * so every number shown here comes from the corrected draft snapshot and its
 * service lines through the shared billing calculator — never from the
 * original denied trip. The original claim number stays visible, clearly
 * separated, and is never reused.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Paperclip, RotateCcw } from "lucide-react";
import { formatDate } from "@/lib/format";
import { money } from "@/lib/resubmissionBilling";
import type { CorrectedReadyCandidate } from "@/lib/readyResubmissions";

export function CorrectedReadyList({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: CorrectedReadyCandidate[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return null;
  const allSelected = rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-300/60 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allSelected}
            onCheckedChange={onToggleAll}
            aria-label="Select all corrected resubmissions"
          />
          <span>
            <strong>{rows.length}</strong> corrected resubmission{rows.length === 1 ? "" : "s"} ready
            — nothing is sent until you start Auto Pilot.
          </span>
        </div>
        <span>{[...selected].filter((id) => rows.some((r) => r.id === id)).length} selected</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.id}
            className="bill-card flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(r.id)}
                  onCheckedChange={() => onToggle(r.id)}
                  aria-label={`Select corrected claim for ${r.passenger_name ?? "passenger"}`}
                />
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.passenger_name ?? "—"}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {r.medicaid_id ?? "—"}
                  </div>
                </div>
              </div>
              <Badge className="shrink-0 rounded-full bg-emerald-600 text-white hover:bg-emerald-600">
                Corrected resubmission
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Corrected date</dt>
              <dd className="text-right font-medium">
                {r.service_date ? formatDate(r.service_date) : "—"}
              </dd>
              <dt className="text-muted-foreground">Driver</dt>
              <dd className="truncate text-right">{r.driver_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Trip units</dt>
              <dd className="text-right">{r.units}</dd>
              <dt className="text-muted-foreground">
                Miles{r.miles_source === "override" ? " (override)" : ""}
              </dt>
              <dd className="text-right">{r.miles}</dd>
              <dt className="text-muted-foreground">Calculated total</dt>
              <dd className="text-right font-semibold">{money(r.total_amount)}</dd>
              <dt className="text-muted-foreground">Modifiers</dt>
              <dd className="text-right">{r.modifiers.length ? r.modifiers.join(", ") : "None"}</dd>
            </dl>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {r.has_attachment ? "Trip report attached" : "No attachment"}
              </span>
              <span>·</span>
              <span>{r.line_count} service line{r.line_count === 1 ? "" : "s"}</span>
            </div>

            {/* The ORIGINAL denied claim: shown for context, kept separate, never reused. */}
            <div className="rounded-xl border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground/80">Original denied claim</div>
              <div className="font-mono">{r.original_claim_number ?? "—"}</div>
              <div className="capitalize">{r.original_status ?? "denied"} — kept unchanged</div>
            </div>

            {r.warnings.length ? (
              <div className="rounded-xl bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                {r.warnings[0]}
              </div>
            ) : null}

            <div className="mt-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => onOpen(r.id)}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                View corrected draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => onOpen(r.id)}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Review changes
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
