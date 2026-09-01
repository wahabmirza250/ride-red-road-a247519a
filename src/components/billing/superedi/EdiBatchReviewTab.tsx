/**
 * Batch Review — validate many claims in one pass.
 *
 * The biller selects any number of bills, hits "Validate All", and the backend
 * decides readiness (`ready === true`). One bad claim never blocks the rest:
 * ready rows stay selected, bad rows can be opened and fixed. No local mileage
 * threshold, no invented statuses — everything shown here came from the
 * backend or from RedArt's own data checks.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ediRowState, exclusionReason, summarizeValidation } from "@/lib/ediBulk";
import type { EdiRowState, EdiValidationSummary } from "@/lib/ediBulk";
import { ediValidateSelection } from "@/lib/ediBulk.functions";
import type { EdiWorkRow } from "@/lib/ediTypes";
import { CountChip, Empty, LongDistancePill, StatePill, dateText, moneyText } from "./ediUi";

const FILTERS: { key: "all" | EdiRowState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "error", label: "Error" },
  { key: "not_validated", label: "Not validated" },
  { key: "batched", label: "In batch" },
  { key: "uploaded", label: "Uploaded" },
];

/** The backend is called in bounded chunks so a 100+ selection stays steady. */
const VALIDATE_CHUNK = 50;

export function EdiBatchReviewTab({
  companyId,
  rows,
  loading,
  fetching,
  total,
  hasMore,
  search,
  onSearch,
  onLoadMore,
  onRefresh,
  selected,
  onToggle,
  onSelectMany,
  onRowsUpdated,
  onOpenRow,
  onOpenSubmission,
  claimReady,
  setupHint,
}: {
  companyId: string | null;
  rows: EdiWorkRow[];
  loading: boolean;
  fetching: boolean;
  total: number;
  hasMore: boolean;
  search: string;
  onSearch: (value: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  selected: Set<string>;
  onToggle: (recordId: string) => void;
  onSelectMany: (recordIds: string[]) => void;
  onRowsUpdated: (rows: EdiWorkRow[]) => void;
  onOpenRow: (recordId: string) => void;
  onOpenSubmission: () => void;
  /** Provider profile is complete enough to create claims. */
  claimReady: boolean;
  setupHint: string | null;
}) {
  const validateFn = useServerFn(ediValidateSelection);
  const [filter, setFilter] = useState<"all" | EdiRowState>("all");
  const [summary, setSummary] = useState<EdiValidationSummary | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => ediRowState(r) === filter)),
    [rows, filter],
  );
  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.record_id)),
    [rows, selected],
  );
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows) {
      const state = ediRowState(r);
      acc[state] = (acc[state] ?? 0) + 1;
    }
    return acc;
  }, [rows]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.record_id));

  const validate = useMutation({
    mutationFn: async (ids: string[]) => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += VALIDATE_CHUNK) {
        chunks.push(ids.slice(i, i + VALIDATE_CHUNK));
      }
      const results: Awaited<ReturnType<typeof validateFn>>["results"] = [];
      let merged: EdiWorkRow[] = [];
      let done = 0;
      setProgress({ done: 0, total: ids.length });
      for (const chunk of chunks) {
        const res = await validateFn({ data: { company_id: companyId, record_ids: chunk } });
        results.push(...res.results);
        merged = [...merged, ...res.rows];
        done += chunk.length;
        setProgress({ done, total: ids.length });
        onRowsUpdated(res.rows);
      }
      return { results, rows: merged };
    },
    onSuccess: ({ results }) => {
      const s = summarizeValidation(results);
      setSummary(s);
      setProgress(null);
      if (s.ready > 0 && s.needsAttention === 0 && s.error === 0) {
        toast.success(`${s.ready} claim${s.ready === 1 ? "" : "s"} ready to file.`);
      } else {
        toast.message(
          `${s.ready} ready · ${s.needsAttention} need attention · ${s.error} error${
            s.error === 1 ? "" : "s"
          }`,
        );
      }
    },
    onError: (e: unknown) => {
      setProgress(null);
      toast.error(e instanceof Error ? e.message : "Validation failed");
    },
  });

  return (
    <div className="space-y-4">
      {/* Bulk toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3 shadow-soft">
        <Checkbox
          checked={allVisibleSelected}
          onCheckedChange={() =>
            onSelectMany(allVisibleSelected ? [] : visible.map((r) => r.record_id))
          }
          aria-label="Select all visible"
        />
        <span className="text-sm text-muted-foreground">
          {selected.size} selected
          {rows.length ? ` of ${rows.length} loaded` : ""}
          {total > rows.length ? ` (${total} total)` : ""}
        </span>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Member, Medicaid ID, date…"
            className="h-9 w-60 rounded-full pl-8 text-sm"
          />
        </div>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onRefresh} disabled={fetching}>
          {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={!selected.size || validate.isPending || !claimReady}
          title={claimReady ? undefined : (setupHint ?? "Finish Provider Setup first")}
          onClick={() => validate.mutate([...selected])}
        >
          {validate.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="mr-2 h-3.5 w-3.5" />
          )}
          {progress ? `Validating ${progress.done}/${progress.total}` : `Validate all (${selected.size})`}
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={onOpenSubmission}>
          Build 837P <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>

      {!claimReady && setupHint && (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{setupHint}</span>
        </div>
      )}

      {summary && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="font-medium text-foreground">Last validation pass</span>
          <CountChip label="ready" value={summary.ready} tone="ready" />
          <CountChip label="need attention" value={summary.needsAttention} tone="warn" />
          <CountChip label="error" value={summary.error} tone="error" />
          {summary.needsAttention + summary.error > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto rounded-full"
              onClick={() => setFilter("needs_attention")}
            >
              Show what needs fixing
            </Button>
          )}
        </div>
      )}

      {/* State filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === "all" ? rows.length : (counts[f.key] ?? 0);
          if (f.key !== "all" && count === 0 && filter !== f.key) return null;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading bills…
        </div>
      ) : visible.length === 0 ? (
        <Empty icon>
          {rows.length === 0
            ? "No bills for this company yet. Import scanned trip forms in Upload / Import."
            : "No bill matches this filter."}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Member</th>
                  <th className="px-3 py-2.5">Service date</th>
                  <th className="px-3 py-2.5">Trip</th>
                  <th className="px-3 py-2.5">Service lines</th>
                  <th className="px-3 py-2.5 text-right">Charge</th>
                  <th className="px-3 py-2.5">Documents</th>
                  <th className="px-3 py-2.5">State</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => {
                  const state = ediRowState(row);
                  const issue =
                    state === "ready" || state === "batched" || state === "generated" || state === "uploaded"
                      ? null
                      : exclusionReason(row);
                  return (
                    <tr
                      key={row.record_id}
                      className={cn(
                        "align-top transition hover:bg-surface-muted/60",
                        selected.has(row.record_id) && "bg-surface-muted/40",
                      )}
                    >
                      <td className="px-3 py-3">
                        <Checkbox
                          checked={selected.has(row.record_id)}
                          onCheckedChange={() => onToggle(row.record_id)}
                          aria-label={`Select ${row.member_name ?? "bill"}`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground">
                          {row.member_name ?? "Unknown member"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.medicaid_id ?? "No Medicaid ID"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-foreground">
                        {dateText(row.service_date)}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        <div className="text-foreground">{row.miles.toFixed(1)} mi</div>
                        <div className="truncate max-w-[220px]">
                          {row.pickup_address ?? "—"} → {row.dropoff_address ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="text-foreground">
                          {row.procedure_codes.join(", ") || "—"}
                          {row.modifiers.length ? ` · ${row.modifiers.join(", ")}` : ""}
                        </div>
                        <div className="text-muted-foreground">
                          {row.units} unit{row.units === 1 ? "" : "s"}
                          {row.diagnosis_code ? ` · dx ${row.diagnosis_code}` : ""}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums text-foreground">
                        {moneyText(row.total_charge)}
                      </td>
                      <td className="px-3 py-3">
                        <LongDistancePill value={row.long_distance} />
                      </td>
                      <td className="px-3 py-3">
                        <StatePill state={state} />
                        {issue && (
                          <div className="mt-1 max-w-[240px] break-words text-xs text-muted-foreground">
                            {issue}
                          </div>
                        )}
                        {row.edi_claim_id && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            claim #{row.edi_claim_id}
                            {row.edi_batch_id ? ` · batch #${row.edi_batch_id}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-full px-2"
                          onClick={() => onOpenRow(row.record_id)}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="border-t border-border p-3 text-center">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={onLoadMore}
                disabled={fetching}
              >
                {fetching ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronDown className="mr-2 h-3.5 w-3.5" />
                )}
                Load more ({rows.length} of {total})
              </Button>
            </div>
          )}
        </div>
      )}

      {selectedRows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Selection is kept while you switch tabs — ready claims stay selected even when other rows
          in the same pass need fixing.
        </p>
      )}
    </div>
  );
}
