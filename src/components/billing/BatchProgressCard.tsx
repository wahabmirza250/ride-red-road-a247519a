import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, AlertTriangle, Clock, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSubmissionBatchProgress } from "@/lib/submissionQueue.functions";

/**
 * Live progress for one "Submit batch" click. Purely presentational: it polls a
 * read-only, RLS-scoped summary and never shows worker or browser internals.
 */
export function BatchProgressCard({
  batchId,
  onDismiss,
}: {
  batchId: string;
  onDismiss: () => void;
}) {
  const progressFn = useServerFn(getSubmissionBatchProgress);
  const { data } = useQuery({
    queryKey: ["submission_batch", batchId],
    queryFn: () => progressFn({ data: { batch_id: batchId } }) as any,
    refetchInterval: (q: any) => (q.state.data?.done ? false : 5000),
  });

  const p = data as any;
  const total = Number(p?.total_requested ?? 0);
  const submitted = Number(p?.submitted ?? 0);
  const completed = Number(p?.completed ?? submitted);
  const waiting = Number(p?.waiting ?? 0);
  const waveSize = Number(p?.wave_size ?? 20);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            Batch progress{total ? ` — ${completed} of ${total} completed` : ""}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {p?.wave_label ?? `Automatic waves of up to ${waveSize}`}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDismiss} aria-label="Hide batch progress">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Chip icon={<Clock className="h-3 w-3" />} label="Queued" value={p?.queued ?? 0} tone="sky" />
        <Chip icon={<Clock className="h-3 w-3" />} label="Next waves" value={waiting} tone="slate" />
        <Chip
          icon={<Loader2 className="h-3 w-3 animate-spin" />}
          label="Processing"
          value={p?.processing ?? 0}
          tone="amber"
        />
        <Chip
          icon={<CheckCircle2 className="h-3 w-3" />}
          label="Submitted"
          value={submitted}
          tone="emerald"
        />
        <Chip
          icon={<ShieldQuestion className="h-3 w-3" />}
          label="Verifying"
          value={p?.verifying ?? 0}
          tone="violet"
        />
        <Chip
          icon={<AlertTriangle className="h-3 w-3" />}
          label="Needs attention"
          value={p?.needs_attention ?? 0}
          tone="rose"
        />
      </div>

      {Array.isArray(p?.claim_ids) && p.claim_ids.length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          Claim IDs:{" "}
          <span className="font-mono text-foreground">
            {p.claim_ids
              .slice(0, 8)
              .map((c: any) => c.claim_id)
              .join(", ")}
          </span>
          {p.claim_ids.length > 8 ? ` +${p.claim_ids.length - 8} more` : ""}
        </div>
      )}

      {p?.done && (p?.queued ?? 0) === 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          Batch finished processing. Anything in “Needs attention” or “Verifying” is waiting on a
          person — nothing is retried automatically.
        </div>
      )}
    </div>
  );
}

const TONES: Record<string, string> = {
  sky: "bg-sky-500/10 text-sky-600",
  amber: "bg-amber-500/10 text-amber-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  violet: "bg-violet-500/10 text-violet-600",
  rose: "bg-rose-500/10 text-rose-600",
  slate: "bg-muted text-muted-foreground",
};

function Chip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof TONES | string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${TONES[tone] ?? TONES["sky"]}`}
    >
      {icon}
      {label}: {value}
    </span>
  );
}
