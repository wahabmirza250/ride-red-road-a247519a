/**
 * The ONE badge that is allowed to say what the state portal did.
 *
 * "Submitted", "Paid", "Denied", "Approved" are only shown when the bill really
 * carries a 13-digit HCPF claim number and the portal has been read back.
 * Without that proof it reads "Awaiting portal verification", so nobody plans
 * payroll or cash flow around a claim that may not exist.
 *
 * Workflow states (Review, Processing, Needs Attention…) are untouched and fall
 * through to the normal status pill.
 */
import { AlertCircle } from "lucide-react";
import { StatusPill } from "@/components/nemt/StatusPill";
import { presentClaimState, type ClaimStateInput } from "@/lib/claimStateSemantics";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-amber-500/10 text-amber-600",
  danger: "bg-destructive/10 text-destructive",
};

export function ClaimStatePill({
  record,
  className,
}: {
  record: ClaimStateInput | null | undefined;
  className?: string;
}) {
  const state = presentClaimState(record);
  if (state.key === "other" || !state.label)
    return <StatusPill status={String(record?.status ?? "")} className={className} />;

  return (
    <span
      title={state.detail ?? undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[state.tone] ?? TONE["neutral"],
        className,
      )}
    >
      {!state.evidenceBacked && <AlertCircle className="h-3 w-3 shrink-0" />}
      {state.label}
    </span>
  );
}
