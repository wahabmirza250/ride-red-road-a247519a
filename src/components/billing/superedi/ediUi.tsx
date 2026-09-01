/**
 * Shared presentation pieces for the Super EDI workspace.
 *
 * Pure display only — no data access, no rules. Everything renders through the
 * theme tokens so light/dark both work.
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileText, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EDI_ROW_STATE_LABEL, type EdiRowState } from "@/lib/ediBulk";
import { NOT_AVAILABLE, type EdiFeedSection } from "@/lib/ediStatusFeed";
import type { EdiLongDistance } from "@/lib/ediLongDistance";

export function moneyText(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

export function dateText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function dateTimeText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const STATE_TONE: Record<EdiRowState, string> = {
  not_validated: "border-border bg-surface-muted text-muted-foreground",
  ready: "border-success/30 bg-success/10 text-success",
  needs_attention: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  batched: "border-info/30 bg-info/10 text-info",
  generated: "border-info/40 bg-info/15 text-info",
  uploaded: "border-success/40 bg-success/15 text-success",
};

const STATE_ICON: Record<EdiRowState, typeof CheckCircle2> = {
  not_validated: Clock3,
  ready: CheckCircle2,
  needs_attention: AlertTriangle,
  error: XCircle,
  batched: FileText,
  generated: FileText,
  uploaded: CheckCircle2,
};

export function StatePill({ state, className }: { state: EdiRowState; className?: string }) {
  const Icon = STATE_ICON[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STATE_TONE[state],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {EDI_ROW_STATE_LABEL[state]}
    </span>
  );
}

const LD_TONE: Record<EdiLongDistance["state"], string> = {
  pending: "border-border bg-surface-muted text-muted-foreground",
  not_required: "border-success/30 bg-success/10 text-success",
  required: "border-warning/40 bg-warning/10 text-warning",
  satisfied: "border-success/30 bg-success/10 text-success",
};

/**
 * The backend owns the long-distance rule. This pill only reports what it
 * said — "Pending backend evaluation" when it has not evaluated the claim.
 */
export function LongDistancePill({ value }: { value: EdiLongDistance }) {
  const title = [
    value.rule ? `Rule: ${value.rule}` : null,
    value.missingDocuments.length ? `Missing: ${value.missingDocuments.join(", ")}` : null,
    value.requiredDocuments.length ? `Required: ${value.requiredDocuments.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title || value.label}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap",
        LD_TONE[value.state],
      )}
    >
      {value.label}
    </span>
  );
}

export function CountChip({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number | string;
  tone?: "muted" | "ready" | "warn" | "error" | "info";
}) {
  const tones: Record<string, string> = {
    muted: "border-border bg-surface text-foreground",
    ready: "border-success/30 bg-success/10 text-success",
    warn: "border-warning/40 bg-warning/10 text-warning",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-info/30 bg-info/10 text-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        tones[tone],
      )}
    >
      <span className="tabular-nums">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-5 shadow-soft", className)}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{value || "—"}</dd>
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {icon ? <Info className="mx-auto mb-2 h-5 w-5 opacity-60" /> : null}
      {children}
    </div>
  );
}

/**
 * 999 / 277 / 835 sections exactly as the backend reported them. A section the
 * backend has not sent yet is shown as "Not available from backend yet" — the
 * UI never invents an acknowledgement.
 */
export function FeedSections({ sections }: { sections: EdiFeedSection[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {sections.map((section) => (
        <div
          key={section.key}
          className={cn(
            "rounded-xl border p-3",
            section.available ? "border-border bg-surface" : "border-dashed border-border bg-surface-muted",
          )}
        >
          <div className="text-xs font-semibold text-foreground">{section.title}</div>
          <div
            className={cn(
              "mt-1 text-sm",
              section.available ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {section.available ? section.summary : NOT_AVAILABLE}
          </div>
          {section.reasons.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              {section.reasons.map((reason, i) => (
                <li key={`${section.key}-r-${i}`} className="break-words">
                  {reason}
                </li>
              ))}
            </ul>
          )}
          {section.amounts.length > 0 && (
            <dl className="mt-2 space-y-1">
              {section.amounts.map((amount, i) => (
                <div key={`${section.key}-a-${i}`} className="flex justify-between gap-2 text-xs">
                  <dt className="text-muted-foreground">{amount.label}</dt>
                  <dd className="tabular-nums text-foreground">{amount.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

/** Generic status pill: shows the backend's own words, never a guess. */
export function Pill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "ready" | "warn" | "error" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: "border-border bg-surface-muted text-muted-foreground",
    ready: "border-success/30 bg-success/10 text-success",
    warn: "border-warning/40 bg-warning/10 text-warning",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-info/30 bg-info/10 text-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
