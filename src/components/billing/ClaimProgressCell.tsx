/**
 * Compact per-claim progress for the Billing "Processing" view.
 *
 * Shows the real robot stage when the automation service reports one, and an
 * honest "Working at HCPF" when it does not — never fake progress. Adds the
 * elapsed time and a warning once a claim runs unusually long. Raw leases and
 * worker internals stay out of the default view.
 */
import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { CLAIM_STAGES, claimProgress } from "@/lib/robotProgress";

export function ClaimProgressCell({
  recordStatus,
  robotStatus,
  startedAt,
}: {
  recordStatus?: string | null;
  robotStatus?: string | null;
  startedAt?: string | null;
}) {
  const p = claimProgress({ recordStatus, robotStatus, startedAt });
  const total = CLAIM_STAGES.length;

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {p.label === "Waiting" ? (
          <Clock className="h-3 w-3" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
        <span className="font-medium text-foreground/80">{p.label}</span>
        {p.step !== null && (
          <span aria-hidden="true">
            · {p.step + 1}/{total}
          </span>
        )}
        {p.elapsedMs !== null && <span>· {p.elapsedLabel}</span>}
      </div>
      {p.slow && (
        <div className="flex items-start gap-1 text-[11px] text-amber-600">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Taking longer than usual ({p.elapsedLabel}). It is being monitored — do not resubmit.
          </span>
        </div>
      )}
    </div>
  );
}
