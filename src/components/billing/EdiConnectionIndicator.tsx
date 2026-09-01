/**
 * Compact EDI connection indicator for the Medicaid Billing workspace.
 *
 * Pings the EDI backend health endpoint through the secure bridge. Purely
 * informational — it never submits or changes any claim.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { EDI_TEST_LABEL } from "@/lib/edi";
import { getEdiHealth } from "@/lib/edi.functions";
import { cn } from "@/lib/utils";

export function EdiConnectionIndicator({ className }: { className?: string }) {
  const health = useQuery({
    queryKey: ["edi_health"],
    queryFn: () => getEdiHealth(),
    refetchInterval: 120000,
    retry: false,
  });

  const state = health.isLoading
    ? "checking"
    : health.data?.ok
      ? "connected"
      : "unavailable";

  const label =
    state === "checking"
      ? "Checking EDI…"
      : state === "connected"
        ? "EDI connected"
        : "EDI unavailable";

  const result = health.data;
  const detail = result && !result.ok ? result.error : null;

  return (
    <button
      type="button"
      onClick={() => health.refetch()}
      title={detail ?? label}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition hover:bg-accent",
        className,
      )}
    >
      {health.isFetching ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            state === "connected"
              ? "bg-emerald-500"
              : state === "unavailable"
                ? "bg-destructive"
                : "bg-muted-foreground",
          )}
        />
      )}
      <PlugZap className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{label}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {EDI_TEST_LABEL}
      </span>
      <RefreshCw className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}
