/**
 * Upload / Import — the bulk entry point of Super EDI.
 *
 * Two ways in, both bulk:
 *   1. Drop many scanned trip PDFs at once. This reuses the app's existing
 *      paper-bill inbox and extractor (one parser, one dedupe fingerprint) —
 *      nothing here re-implements extraction, and nothing is ever submitted
 *      automatically.
 *   2. Pick existing electronic bills that already live in RedArt.
 *
 * Everything imported/selected here flows into the Batch Review selection.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, FileUp, Layers, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BatchPaperBills, type PaperImportProgress } from "@/components/billing/BatchPaperBills";
import { listEdiWorkbench } from "@/lib/ediRecords.functions";
import type { EdiWorkRow } from "@/lib/ediTypes";
import { CountChip, Empty, Panel, StatePill, dateText, moneyText } from "./ediUi";
import { ediRowState } from "@/lib/ediBulk";

export function EdiUploadTab({
  companyId,
  selected,
  onToggle,
  onSelectMany,
  onOpenReview,
}: {
  companyId: string | null;
  selected: Set<string>;
  onToggle: (recordId: string) => void;
  onSelectMany: (recordIds: string[]) => void;
  onOpenReview: () => void;
}) {
  const listFn = useServerFn(listEdiWorkbench);
  const [progress, setProgress] = useState<PaperImportProgress | null>(null);
  const [search, setSearch] = useState("");
  const [importedTripIds, setImportedTripIds] = useState<string[]>([]);

  const unlinked = useQuery({
    queryKey: ["edi", "workbench", "unlinked", companyId, search],
    queryFn: () =>
      listFn({
        data: {
          company_id: companyId,
          scope: "unlinked" as const,
          limit: 100,
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      }),
  });

  const rows = unlinked.data?.rows ?? [];
  const visibleIds = useMemo(() => rows.map((r) => r.record_id), [rows]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  /** After a paper import, resolve the new bills and pre-select them. */
  async function adoptImportedTrips(trips: { trip_id: string }[]) {
    const tripIds = trips.map((t) => t.trip_id).filter(Boolean);
    if (!tripIds.length) return;
    setImportedTripIds((prev) => [...new Set([...prev, ...tripIds])]);
    try {
      const page = await listFn({ data: { company_id: companyId, trip_ids: tripIds } });
      const ids = page.rows.map((r) => r.record_id);
      if (ids.length) {
        onSelectMany(ids);
        toast.success(
          `${ids.length} imported trip${ids.length === 1 ? "" : "s"} added to the batch selection.`,
        );
      }
      await unlinked.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Imported, but could not add them to the batch");
    }
  }

  return (
    <div className="space-y-6">
      {progress && progress.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-muted px-4 py-3">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Import queue
          </span>
          <CountChip label="files" value={progress.total} />
          {progress.uploading > 0 && <CountChip label="uploading" value={progress.uploading} tone="info" />}
          {progress.extracting > 0 && (
            <CountChip label="extracting" value={progress.extracting} tone="info" />
          )}
          <CountChip label="draft ready" value={progress.draftReady} tone="ready" />
          {progress.needsReview > 0 && (
            <CountChip label="need review" value={progress.needsReview} tone="warn" />
          )}
          {progress.saving > 0 && <CountChip label="saving" value={progress.saving} tone="info" />}
          <CountChip label="imported" value={progress.imported} tone="ready" />
          {progress.failed > 0 && <CountChip label="failed" value={progress.failed} tone="error" />}
        </div>
      )}

      <Panel
        title="Scanned trip forms"
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileUp className="h-3.5 w-3.5" /> Drop 20, 100+ PDFs at once
          </span>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Each PDF is fingerprinted, extracted and turned into an electronic draft. A file that was
          already imported is recognised and never creates a second bill. Nothing is filed with the
          payer from this screen.
        </p>
        <BatchPaperBills
          embedded
          companyId={companyId}
          onImported={adoptImportedTrips}
          onProgress={setProgress}
        />
      </Panel>

      <Panel
        title="Existing electronic bills"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Member, Medicaid ID, date…"
                className="h-8 w-56 rounded-full pl-8 text-sm"
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => void unlinked.refetch()}
              disabled={unlinked.isFetching}
            >
              {unlinked.isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={!visibleIds.length}
            onClick={() => onSelectMany(allVisibleSelected ? [] : visibleIds)}
          >
            <Layers className="mr-2 h-3.5 w-3.5" />
            {allVisibleSelected ? "Clear these" : `Add all ${visibleIds.length} to batch`}
          </Button>
          <CountChip label="in selection" value={selected.size} tone={selected.size ? "info" : "muted"} />
          {importedTripIds.length > 0 && (
            <CountChip label="imported this session" value={importedTripIds.length} tone="ready" />
          )}
          <Button size="sm" variant="ghost" className="ml-auto rounded-full" onClick={onOpenReview}>
            Go to Batch Review <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>

        {unlinked.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading bills…
          </div>
        ) : unlinked.isError ? (
          <Empty>
            {unlinked.error instanceof Error ? unlinked.error.message : "Could not load bills"}
          </Empty>
        ) : rows.length === 0 ? (
          <Empty icon>
            No bills without an EDI claim
            {search.trim() ? " match this search" : ""}. Import scanned forms above, or check Batch
            Review for claims already created.
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <CandidateRow
                key={row.record_id}
                row={row}
                checked={selected.has(row.record_id)}
                onToggle={() => onToggle(row.record_id)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CandidateRow({
  row,
  checked,
  onToggle,
}: {
  row: EdiWorkRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label="Add to batch" />
      <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
        <div className="truncate text-sm font-medium text-foreground">
          {row.member_name ?? "Unknown member"}
          <span className="ml-2 font-normal text-muted-foreground">
            {row.medicaid_id ?? "no Medicaid ID"}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {dateText(row.service_date)} · {row.miles.toFixed(1)} mi ·{" "}
          {row.procedure_codes.join(", ") || "no procedure code"} · {moneyText(row.total_charge)}
        </div>
      </button>
      <StatePill state={ediRowState(row)} />
    </li>
  );
}
