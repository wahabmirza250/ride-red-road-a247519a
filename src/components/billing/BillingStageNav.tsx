import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StageNavItem = {
  key: string;
  label: string;
  /** Real count from the billing counts query; `null` hides the badge. */
  count: number | null;
  /** Short plain-English hint (kept for the tooltip only). */
  hint?: string;
};

/**
 * The claims filter row: one clean, responsive segmented control that wraps
 * onto a second line rather than truncating or hiding stages. Purely
 * presentational — stage keys, counts and tools all come from the workspace.
 */
export function BillingStageNav({
  stages,
  active,
  onSelect,
  secondary,
  secondaryActiveLabel,
  onSelectSecondary,
  trailing,
}: {
  stages: StageNavItem[];
  active: string;
  onSelect: (key: string) => void;
  secondary: { key: string; label: string }[];
  secondaryActiveLabel?: string | null;
  onSelectSecondary: (key: string) => void;
  trailing?: ReactNode;
}) {
  const all = stages;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Claim stages"
        className="flex min-w-0 flex-1 flex-wrap gap-1 rounded-2xl border border-border bg-surface p-1.5 shadow-soft"
      >
        {all.map((s) => {
          const isActive = s.key === active;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={(s as StageNavItem).hint}
              onClick={() =>
                secondary.some((x) => x.key === s.key) ? onSelectSecondary(s.key) : onSelect(s.key)
              }
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[13px] font-medium transition",
                isActive
                  ? "bill-pill-active"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {s.label}
              {s.count !== null && (
                <span
                  className={cn(
                    "inline-flex min-w-[1.4rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                    isActive ? "bg-white/20 text-white" : "bg-muted text-foreground/70",
                  )}
                >
                  {s.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className="text-sm text-muted-foreground">
        <span className="sr-only">Tracking and other billing tools</span>
        <select
          aria-label="Tracking and other billing tools"
          className="h-10 max-w-full rounded-xl border border-border bg-surface px-3 text-foreground"
          value={secondaryActiveLabel ? active : ""}
          onChange={(event) => onSelectSecondary(event.target.value)}
        >
          <option value="" disabled>Track bills &amp; more</option>
          {secondary.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
