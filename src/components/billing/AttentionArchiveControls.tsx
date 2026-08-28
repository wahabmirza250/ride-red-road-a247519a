import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ArchiveRestore, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archiveAttentionRecords } from "@/lib/needsAttentionArchive.functions";
import { decideAttentionAction } from "@/lib/needsAttentionArchive";

/**
 * Clears resolved error clutter out of the ACTIVE Needs Attention list.
 *
 * Presentation only: archiving stamps the record, it never deletes evidence,
 * never resets a status and never makes an uncertain HCPF outcome retryable.
 * Rows the server would refuse are filtered out here too, so the button count
 * always matches what will actually happen.
 */
export function AttentionArchiveControls({
  rows,
  selectedIds,
  showArchived = false,
  onToggleArchived,
  onDone,
}: {
  rows: any[];
  selectedIds: string[];
  showArchived?: boolean;
  onToggleArchived?: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const archiveFn = useServerFn(archiveAttentionRecords);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(rows.map((r: any) => [r.id as string, r])), [rows]);

  const archivable = useMemo(
    () =>
      selectedIds.filter((id) => {
        const r = byId.get(id);
        if (!r || r.attention_archived_at) return false;
        return decideAttentionAction(r).action === "archive";
      }),
    [selectedIds, byId],
  );

  async function archive() {
    if (!archivable.length) return;
    setBusy(true);
    try {
      const res: any = await archiveFn({ data: { ids: archivable } });
      const n = res?.archived?.length ?? 0;
      const skipped = res?.skipped ?? [];
      if (n) toast.success(`${n} resolved item${n === 1 ? "" : "s"} archived — history kept.`);
      for (const s of skipped.slice(0, 3)) toast.info(s.reason);
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not archive those items.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {onToggleArchived && (
        <Button variant="ghost" size="sm" onClick={onToggleArchived}>
          {showArchived ? (
            <>
              <EyeOff className="mr-2 h-4 w-4" /> Hide archived
            </>
          ) : (
            <>
              <Eye className="mr-2 h-4 w-4" /> Show archived
            </>
          )}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={archive} disabled={!archivable.length || busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
        Archive resolved{archivable.length ? ` (${archivable.length})` : ""}
      </Button>
    </>
  );
}

/** Single-row restore, used from the detail sheet. */
export function UnarchiveButton({ id, onDone }: { id: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { unarchiveAttentionRecord } = await import("@/lib/needsAttentionArchive.functions");
          await unarchiveAttentionRecord({ data: { id } });
          toast.success("Restored to Needs Attention.");
          qc.invalidateQueries({ queryKey: ["billing_list"] });
          qc.invalidateQueries({ queryKey: ["billing_detail"] });
          onDone?.();
        } catch (e: any) {
          toast.error(e?.message ?? "Could not restore this item.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
      Restore
    </Button>
  );
}
