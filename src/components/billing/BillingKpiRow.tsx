import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileStack,
  Send,
  Timer,
  XOctagon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type BillingCounts = Record<string, number> | undefined;

/**
 * The six numbers a biller checks first, in one calm row.
 * Purely presentational — every value comes from the existing billing counts
 * query; nothing here fetches, mutates or triggers work.
 */
export function BillingKpiRow({
  counts,
  loading,
  onSelect,
}: {
  counts: BillingCounts;
  loading?: boolean;
  onSelect?: (stage: string) => void;
}) {
  const n = (k: string) => Number(counts?.[k] ?? 0);
  const paid = n("paid");
  const denied = n("denied") + n("rejected");
  const queued = n("queued") + n("pending_submit");
  const total =
    n("pending_review") +
    n("approved") +
    n("needs_fix") +
    n("submitting") +
    n("submitted") +
    queued +
    paid +
    denied;

  const cards: {
    key: string;
    label: string;
    value: number;
    hint: string;
    icon: ReactNode;
    tone: string;
    stage?: string;
  }[] = [
    {
      key: "total",
      label: "Total Claims",
      value: total,
      hint: "All bills on file",
      icon: <FileStack className="h-4 w-4" />,
      tone: "bg-plum-soft text-[color:var(--plum)]",
    },
    {
      key: "paid",
      label: "Paid",
      value: paid,
      hint: "Paid by the state",
      icon: <CheckCircle2 className="h-4 w-4" />,
      tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      stage: "claims_history",
    },
    {
      key: "submitted",
      label: "Submitted",
      value: n("submitted"),
      hint: "Claim number saved",
      icon: <Send className="h-4 w-4" />,
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
      stage: "submitted",
    },
    {
      key: "needs_attention",
      label: "Needs Attention",
      value: n("needs_attention"),
      hint: "A person has to act",
      icon: <AlertTriangle className="h-4 w-4" />,
      tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      stage: "needs_attention",
    },
    {
      key: "denied",
      label: "Rejected / Denied",
      value: denied,
      hint: "Denied by the state",
      icon: <XOctagon className="h-4 w-4" />,
      tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
      stage: "denied",
    },
    {
      key: "queued",
      label: "Queued",
      value: queued + n("submitting"),
      hint: "Waiting at the portal",
      icon: <Timer className="h-4 w-4" />,
      tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
      stage: "awaiting_portal",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          disabled={!c.stage || !onSelect}
          onClick={() => c.stage && onSelect?.(c.stage)}
          className={cn(
            "bill-card min-w-0 p-4 text-left transition",
            c.stage && onSelect ? "hover:shadow-lift" : "cursor-default",
          )}
        >
          <div className={cn("grid h-8 w-8 place-items-center rounded-full", c.tone)}>
            {c.icon}
          </div>
          <div className="mt-3 text-2xl font-semibold tabular-nums text-foreground">
            {loading ? "—" : c.value.toLocaleString()}
          </div>
          <div className="truncate text-[13px] font-medium text-foreground/80">{c.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{c.hint}</div>
        </button>
      ))}
    </div>
  );
}
