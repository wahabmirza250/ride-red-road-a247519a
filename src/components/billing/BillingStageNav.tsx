import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type StageNavItem = {
  key: string;
  label: string;
  /** Real count from the billing counts query; `null` hides the badge. */
  count: number | null;
  /** Short plain-English hint under the label. */
  hint?: string;
};

/**
 * The primary billing flow, rendered as a left-to-right rail of four stages so
 * a biller can read the pipeline in one glance. Purely presentational: the
 * stage keys, counts and secondary tools all come from the workspace.
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
  secondaryActiveLabel: string | null;
  onSelectSecondary: (key: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-1.5 shadow-soft">
      <div className="flex flex-col gap-1.5 lg:flex-row lg:items-stretch">
        <div
          role="tablist"
          aria-label="Billing workflow stages"
          className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
        >
          {stages.map((s, i) => {
            const isActive = s.key === active;
            return (
              <div key={s.key} className="flex min-w-0 flex-1 items-center">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelect(s.key)}
                  className={cn(
                    "group min-w-0 flex-1 rounded-xl px-3 py-2 text-left transition-colors",
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/25"
                      : "hover:bg-muted/60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "truncate text-sm font-semibold",
                        isActive ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                    {s.count !== null && (
                      <span
                        className={cn(
                          "ml-auto inline-flex min-w-[1.5rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                          isActive
                            ? "bg-primary/15 text-foreground"
                            : "bg-muted text-foreground/70",
                        )}
                      >
                        {s.count}
                      </span>
                    )}
                  </div>
                  {s.hint && (
                    <div className="truncate text-[11px] text-muted-foreground">{s.hint}</div>
                  )}
                </button>
                {i < stages.length - 1 && (
                  <ChevronRight
                    aria-hidden
                    className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/40 lg:block"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 lg:border-l lg:border-border lg:pl-1.5">
          {trailing}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={secondaryActiveLabel ? "secondary" : "ghost"}
                className="rounded-full text-muted-foreground data-[state=open]:text-foreground"
              >
                {secondaryActiveLabel ?? "More tools"}
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {secondary.map((t) => (
                <DropdownMenuItem key={t.key} onSelect={() => onSelectSecondary(t.key)}>
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
