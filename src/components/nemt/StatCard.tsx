import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: "primary" | "success" | "info" | "warning" | "surface";
  className?: string;
}) {
  const ring =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
        ? "text-success"
        : accent === "info"
          ? "text-info"
          : accent === "warning"
            ? "text-warning-foreground"
            : accent === "surface"
              ? "text-surface-accent"
              : "text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-5 shadow-soft transition hover:shadow-lift",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </div>
          {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        {icon ? <div className={cn("shrink-0", ring)}>{icon}</div> : null}
      </div>
    </div>
  );
}
