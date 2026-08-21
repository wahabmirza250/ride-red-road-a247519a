import { REAL_SUBMISSIONS_PAUSED } from "@/lib/submissionPause";
import { DuplicateSubmitDialog } from "@/components/billing/DuplicateSubmitDialog";
import { parseDuplicateClaimError, type DuplicateClaimInfo } from "@/lib/duplicateSubmit";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  Eye,
  FileDown,
  Send,
  CheckCircle2,
  Search,
  Bot,
  Clock,
  Ban,
  Trash2,
  Pencil,
} from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import {
  cancelSubmission,
  deleteBillingRecords,
  listSubmissionQueue,
  getBillingCounts,
  getBillingSettings,
  listBillingRecords,
  markPortalSubmitted,
  startRobotForRecord,
  startRobotForRecords,
  sweepRobotJobsForCompany,

} from "@/lib/billing.functions";
import { getPortal } from "@/lib/portals";
import { BillingDetailSheet } from "@/components/billing/BillingDetailSheet";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";
import { ClaimsHistoryTab } from "@/components/billing/ClaimsHistoryTab";
import { FixBillDialog } from "@/components/billing/FixBillDialog";

import {
  cancelSubmissionClient,
  deleteBillingRecordsClient,
  getBillingCountsClient,
  listBillingRecordsClient,
} from "@/lib/billingClient";
import { friendlyErrorMessage } from "@/lib/errorMessage";

/** A server-function call that died at the edge rejects with the HTML error shell. */
function looksLikeEdgeFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const lower = msg.toLowerCase();
  return (
    lower.includes("<!doctype") ||
    lower.includes("<html") ||
    lower.includes("this page didn't load") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("500")
  );
}


type TabKey = "pending_review" | "ready_to_submit" | "awaiting_portal" | "submitted" | "claims_history";

const TABS: {
  key: TabKey;
  label: string;
  statuses: (
    | "pending_review"
    | "approved"
    | "queued"
    | "submitting"
    | "needs_fix"
    | "pending_submit"
    | "submitted"
  )[];
  countKeys: string[];
}[] = [
  {
    key: "pending_review",
    label: "Pending Review",
    statuses: ["pending_review"],
    countKeys: ["pending_review"],
  },
  {
    key: "ready_to_submit",
    label: "Ready to Submit",
    statuses: ["approved", "needs_fix"],
    countKeys: ["approved", "needs_fix"],
  },
  {
    // Anything the robot is actively working on ("submitting"), waiting its
    // turn for the portal session ("queued"), plus claims it already filled in
    // and handed back for a human portal submit.
    key: "awaiting_portal",
    label: "Awaiting Portal Submission",
    statuses: ["submitting", "queued", "pending_submit"],
    countKeys: ["submitting", "queued", "pending_submit"],
  },


  {
    key: "submitted",
    label: "Submitted",
    statuses: ["submitted"],
    countKeys: ["submitted"],
  },
  {
    key: "claims_history",
    label: "Claims History",
    statuses: ["submitted"],
    countKeys: [],
  },
];


/** The full billing workflow. Lives in the dedicated Billing app; admins can
 *  reach it too. */
/**
 * `embedded` is used when the workspace is nested inside another tabbed page
 * (the admin dashboard). It drops the duplicate page header and the rates
 * card so the stage tabs stay at the top of the panel instead of being pushed
 * far below the fold.
 */
export function BillingWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const { isAdmin, isBilling } = useAuth();
  const canBill = isAdmin || isBilling;
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("pending_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null);

  const listFn = useServerFn(listBillingRecords);
  const countsFn = useServerFn(getBillingCounts);
  const settingsFn = useServerFn(getBillingSettings);

  const activeTab = TABS.find((t) => t.key === tab)!;

  const rows = useQuery({
    queryKey: ["billing_list", tab],
    queryFn: async () => {
      try {
        return await listFn({ data: { statuses: activeTab.statuses } });
      } catch {
        // Edge server functions can fail on custom domains — read directly instead.
        return await listBillingRecordsClient(activeTab.statuses as string[]);
      }
    },
    enabled: canBill,
    // A robot job can settle at any moment; never show a frozen snapshot.
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const counts = useQuery({
    queryKey: ["billing_counts"],
    queryFn: async () => {
      try {
        return await countsFn();
      } catch {
        return await getBillingCountsClient();
      }
    },
    enabled: canBill,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });


  const settings = useQuery({
    queryKey: ["billing_settings"],
    queryFn: () => settingsFn(),
    enabled: canBill,
  });
  const defaultPortal = getPortal(settings.data?.default_portal_id);

  // Realtime — invalidate on any billing_records change
  useEffect(() => {
    const ch = supabase
      .channel("billing_records_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "billing_records" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["billing_list"] });
          qc.invalidateQueries({ queryKey: ["billing_detail"] });
          qc.invalidateQueries({ queryKey: ["billing_counts"] });
          qc.invalidateQueries({ queryKey: ["submission_queue"] });

          // Surface a terminal failure immediately: the row leaves the
          // "Awaiting portal" list the moment it fails, so without this the
          // only signal is a row silently disappearing.
          const next: any = payload?.new;
          const prev: any = payload?.old;
          if (
            next?.status === "needs_fix" &&
            prev?.status !== "needs_fix" &&
            next?.submission_error
          ) {
            toast.error(`Submission failed: ${next.submission_error}`);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);


  // Background status sweep. Robot results used to land only while a detail
  // sheet was open, which is why a 4-minute job looked like an 18-minute one.
  // While the billing app is open we reconcile every in-flight job for the
  // company and release the next queued submission. (pg_cron does the same
  // server-side when nobody has the app open.)
  const sweepFn = useServerFn(sweepRobotJobsForCompany);
  useEffect(() => {
    if (!canBill) return;
    let stopped = false;
    let running = false;
    const tick = async () => {
      if (running || stopped || document.hidden) return;
      running = true;
      try {
        const out: any = await sweepFn({});
        if (!stopped && (out?.settled > 0 || out?.started)) {
          qc.invalidateQueries({ queryKey: ["billing_list"] });
          qc.invalidateQueries({ queryKey: ["billing_detail"] });
          qc.invalidateQueries({ queryKey: ["billing_counts"] });
          qc.invalidateQueries({ queryKey: ["submission_queue"] });
        }
      } catch {
        // A failed sweep is harmless — the next tick (or cron) retries.
      } finally {
        running = false;
      }
    };
    void tick();
    const id = window.setInterval(tick, 15000);
    // Coming back to a backgrounded tab must never show a 6-minute-old queue.
    const onVisible = () => {
      if (!document.hidden) {
        qc.invalidateQueries({ queryKey: ["submission_queue"] });
        qc.invalidateQueries({ queryKey: ["billing_list"] });
        qc.invalidateQueries({ queryKey: ["billing_counts"] });
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canBill, qc, sweepFn]);




  function countFor(key: TabKey) {
    const t = TABS.find((x) => x.key === key)!;
    if (!counts.data || t.countKeys.length === 0) return null;
    return t.countKeys.reduce((sum, k) => sum + (counts.data![k] ?? 0), 0);
  }


  if (!canBill) {
    return <div className="p-6 text-sm text-muted-foreground">Billing staff only.</div>;
  }

  return (
    <div className={embedded ? "space-y-4" : "surface-red space-y-6"}>
      {!embedded && (
        <PageHeader
          title="Medicaid Billing"
          description="Review driver-submitted trips, batch-send them to the automation robot, then confirm the state's receipt number after human portal submission."
        />
      )}

      {!defaultPortal && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">No default billing portal selected</div>
            <div className="text-xs">
              Go to <strong>Team &amp; apps → Billing portal</strong> to choose
              which state portal these trips submit to.
            </div>
          </div>
        </div>
      )}

      {defaultPortal && !embedded && (
        <div className="text-xs text-muted-foreground">
          Billing through <strong>{defaultPortal.name}</strong> · {defaultPortal.state}
        </div>
      )}

      {isAdmin && !embedded && <BillingRatesCard />}


      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap sm:flex-wrap">
          {TABS.map((t) => {
            const c = countFor(t.key);
            return (
              <TabsTrigger key={t.key} value={t.key} className="shrink-0 whitespace-nowrap">
                {t.label}
                {c !== null && (
                  <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-foreground/80">
                    {c}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {tab === "claims_history" ? (
        <ClaimsHistoryTab />
      ) : rows.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tab === "pending_review" ? (

        <PendingReviewTab
          rows={rows.data ?? []}
          onOpen={setSelectedId}
          onPreviewPdf={setPdfPreview}
        />
      ) : tab === "ready_to_submit" ? (
        <ReadyToSubmitTab
          rows={rows.data ?? []}
          onOpen={setSelectedId}
          onPreviewPdf={setPdfPreview}
        />
      ) : tab === "awaiting_portal" ? (
        <AwaitingPortalTab
          rows={rows.data ?? []}
          onOpen={setSelectedId}
          onPreviewPdf={setPdfPreview}
        />
      ) : (
        <SubmittedTab
          rows={rows.data ?? []}
          onOpen={setSelectedId}
          onPreviewPdf={setPdfPreview}
        />
      )}

      <BillingDetailSheet id={selectedId} onClose={() => setSelectedId(null)} />
      <PdfPreviewDialog
        url={pdfPreview?.url ?? null}
        filename={pdfPreview?.filename ?? "trip.pdf"}
        onClose={() => setPdfPreview(null)}
      />
    </div>
  );
}

/* ------------------------------- shared row bits ------------------------------- */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/** Delete selected / delete all controls shared by the review + submit tabs. */
function DeleteControls({
  selectedIds,
  allIds,
  onDone,
}: {
  selectedIds: string[];
  allIds: string[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteBillingRecords);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirmIds?.length) return;
    setBusy(true);
    try {
      let res: any;
      try {
        res = await deleteFn({ data: { ids: confirmIds } });
      } catch (e) {
        if (!looksLikeEdgeFailure(e)) throw e;
        res = await deleteBillingRecordsClient(confirmIds);
      }
      if (res.deleted) {
        toast.success(`Deleted ${res.deleted} bill${res.deleted === 1 ? "" : "s"}`);
      }
      if (res.blocked?.length) {
        toast.warning(
          `${res.blocked.length} kept — ${res.blocked[0].reason}. Submitted claims can never be deleted.`,
        );
      } else if (res.skipped) {
        toast.message(`${res.skipped} could not be removed and were kept.`);
      }
      setConfirmIds(null);
      onDone();
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
    } catch (e) {
      toast.error(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!selectedIds.length}
        onClick={() => setConfirmIds(selectedIds)}
      >
        <Trash2 className="mr-1 h-4 w-4" /> Delete selected
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        disabled={!allIds.length}
        onClick={() => setConfirmIds(allIds)}
      >
        Clear all
      </Button>

      <Dialog open={!!confirmIds} onOpenChange={(o) => !o && setConfirmIds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmIds?.length ?? 0} bill(s)?</DialogTitle>
            <DialogDescription>
              These bills will be removed from the billing workflow and their trips marked
              rejected. Claims already submitted to Medicaid can't be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmIds(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void run()} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}



function PdfCell({
  pdfUrl,
  passengerName,
  onPreview,
}: {
  pdfUrl: string | null;
  passengerName: string | null;
  onPreview: (p: { url: string; filename: string }) => void;
}) {
  if (!pdfUrl) return <span className="text-xs text-muted-foreground">—</span>;
  const filename = `trip-${(passengerName ?? "rider").replace(/\s+/g, "_")}.pdf`;
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onPreview({ url: pdfUrl, filename })}
      >
        <Eye className="mr-1 h-3.5 w-3.5" /> View
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadPdf(pdfUrl, filename)}
      >
        <FileDown className="mr-1 h-3.5 w-3.5" /> PDF
      </Button>
    </div>
  );
}

async function fetchPdfBlobUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Load failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
}

async function downloadPdf(url: string, filename: string) {
  try {
    const blobUrl = await fetchPdfBlobUrl(url);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not download PDF");
  }
}

/* ------------------------------- TAB 1: Pending Review ------------------------------- */

function PendingReviewTab({
  rows,
  onOpen,
  onPreviewPdf,
}: {
  rows: any[];
  onOpen: (id: string) => void;
  onPreviewPdf: (p: { url: string; filename: string }) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allIds = useMemo(() => rows.map((r) => r.id as string), [rows]);

  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => allIds.includes(id))));
  }, [allIds]);

  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!rows.length)
    return <EmptyState message="No trips awaiting review." />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3">
        <div className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
            aria-label="Select all"
          />
          <span className="text-muted-foreground">
            {selected.size} of {allIds.length} selected
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteControls
            selectedIds={[...selected]}
            allIds={allIds}
            onDone={() => setSelected(new Set())}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3 text-left">Passenger</th>
              <th className="px-4 py-3 text-left">Driver</th>
              <th className="px-4 py-3 text-left">Trip date</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-accent/60"
                onClick={() => onOpen(r.id)}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggleOne(r.id)}
                    aria-label="Select trip"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.passenger_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.medicaid_id}</div>
                </td>
                <td className="px-4 py-3">{r.driver_name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDateTime(r.pickup_at)}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <PdfCell
                    pdfUrl={r.pdf_url}
                    passengerName={r.passenger_name}
                    onPreview={onPreviewPdf}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------- TAB 2: Ready to Submit ------------------------------- */

function ReadyToSubmitTab({
  rows,
  onOpen,
  onPreviewPdf,
}: {
  rows: any[];
  onOpen: (id: string) => void;
  onPreviewPdf: (p: { url: string; filename: string }) => void;
}) {
  const qc = useQueryClient();
  const startFn = useServerFn(startRobotForRecord);
  const startBatchFn = useServerFn(startRobotForRecords);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [duplicate, setDuplicate] = useState<{ id: string; info: DuplicateClaimInfo } | null>(
    null,
  );
  const [fixId, setFixId] = useState<string | null>(null);

  // A bill that already carries a portal confirmation number is a real live
  // claim, whatever its billing status says — never selectable for submit or
  // delete here.
  const selectableIds = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (r.status === "approved" || r.status === "needs_fix") &&
            !r.state_confirmation_number,
        )
        .map((r) => r.id as string),
    [rows],
  );


  // Prune stale selections when rows change
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (selectableIds.includes(id)) next.add(id);
      return next;
    });
  }, [selectableIds]);

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableIds));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitOne(id: string, acknowledge = false) {
    setSubmittingIds((prev) => new Set([...prev, id]));
    try {
      const res: any = await startFn({
        data: { id, mode: "full", acknowledge_duplicate: acknowledge },
      });
      if (res?.queued) {
        toast.info(
          `Trip ${id.slice(0, 8)}… is queued behind ${res.ahead + 1} submission(s). It starts automatically — the portal only allows one at a time.`,
        );
      }
      return "ok" as const;

    } catch (e: any) {
      const dup = parseDuplicateClaimError(e);
      if (dup) {
        // Needs a deliberate confirmation from the biller before we retry.
        setDuplicate({ id, info: dup });
        return "duplicate" as const;
      }
      toast.error(`Trip ${id.slice(0, 8)}…: ${e?.message ?? "Failed"}`);
      return "failed" as const;
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
    }
  }

  /**
   * Bulk submit goes through ONE server call: every selected record is parked
   * in the shared queue and the dispatcher immediately fills all free
   * concurrency slots in parallel. The rest start automatically as slots free.
   */
  async function submitSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSubmittingIds(new Set(ids));
    try {
      const res: any = await startBatchFn({ data: { ids, acknowledge_duplicate: false } });
      setSelected(new Set());
      if (res?.started) {
        toast.success(
          `Started ${res.started} robot job${res.started === 1 ? "" : "s"} in parallel` +
            (res.queued > res.started
              ? ` — ${res.queued - res.started} queued, starting automatically as slots free.`
              : "."),
        );
      } else if (res?.queued) {
        toast.info(`${res.queued} claim(s) queued — they start automatically as slots free.`);
      }
      if (res?.skipped?.length) {
        toast.message(`${res.skipped.length} skipped: ${res.skipped[0].reason}`);
      }
      if (!res?.queued && !res?.skipped?.length) toast.message("Nothing to submit.");
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk submit failed");
    } finally {
      setSubmittingIds(new Set());
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
    }
  }

  if (!rows.length)
    return <EmptyState message="No approved trips waiting to be sent to the robot." />;

  return (
    <div className="space-y-3">
      <DuplicateSubmitDialog
        info={duplicate?.info ?? null}
        busy={submittingIds.size > 0}
        onCancel={() => setDuplicate(null)}
        onConfirm={async () => {
          const target = duplicate;
          setDuplicate(null);
          if (!target) return;
          const res = await submitOne(target.id, true);
          if (res === "ok") toast.success("Resubmission started — recorded in the audit trail.");
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3">
        <div className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => toggleAll()}
            disabled={!selectableIds.length}
            aria-label="Select all"
          />
          <span className="text-muted-foreground">
            {selected.size} of {selectableIds.length} selected
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteControls
            selectedIds={[...selected]}
            allIds={selectableIds}
            onDone={() => setSelected(new Set())}
          />
          <Button
            onClick={submitSelected}
            disabled={!selected.size || submittingIds.size > 0}
          >
            {submittingIds.size > 0 ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Submit Claims
          </Button>
        </div>
      </div>


      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3 text-left">Passenger</th>
              <th className="px-4 py-3 text-left">Driver</th>
              <th className="px-4 py-3 text-left">Trip date</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const canSelect = r.status === "approved" || r.status === "needs_fix";
              const isRunning =
                submittingIds.has(r.id) || r.status === "submitting";
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-accent/60"
                  onClick={() => onOpen(r.id)}
                >
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggleOne(r.id)}
                      disabled={!canSelect || isRunning}
                      aria-label="Select trip"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.passenger_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.medicaid_id}
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.driver_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDateTime(r.pickup_at)}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "queued" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600">
                        waiting in queue
                      </span>
                    ) : isRunning ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                        <Loader2 className="h-3 w-3 animate-spin" /> robot running
                      </span>
                    ) : r.status === "needs_fix" ? (

                      <StatusPill status="needs_fix" />
                    ) : (
                      <StatusPill status="approved" />
                    )}
                    {r.submission_error && !isRunning && (
                      <div className="mt-1 flex items-start gap-1 text-xs text-destructive">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{r.submission_error}</span>
                      </div>
                    )}
                    {!isRunning && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 rounded-full px-3 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFixId(r.id);
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        Edit &amp; fix
                      </Button>
                    )}
                  </td>

                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <PdfCell
                      pdfUrl={r.pdf_url}
                      passengerName={r.passenger_name}
                      onPreview={onPreviewPdf}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FixBillDialog id={fixId} onClose={() => setFixId(null)} />
    </div>
  );
}


/* ------------------------------- TAB 3: Awaiting Portal ------------------------------- */

function AwaitingPortalTab({
  rows,
  onOpen,
  onPreviewPdf,
}: {
  rows: any[];
  onOpen: (id: string) => void;
  onPreviewPdf: (p: { url: string; filename: string }) => void;
}) {
  const qc = useQueryClient();
  const [confirmFor, setConfirmFor] = useState<any | null>(null);
  const [cancelFor, setCancelFor] = useState<any | null>(null);
  const queueFn = useServerFn(listSubmissionQueue);
  const startFn = useServerFn(startRobotForRecord);
  const queue = useQuery({
    queryKey: ["submission_queue"],
    queryFn: () => queueFn() as Promise<any[]>,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const queueById = new Map((queue.data ?? []).map((q: any) => [q.id, q]));

  const [dupQueue, setDupQueue] = useState<{ id: string; info: DuplicateClaimInfo } | null>(null);

  /** One-shot: capture + submit + confirm in a single robot job. */
  const oneShot = useMutation({
    mutationFn: (v: { id: string; acknowledge?: boolean }) =>
      startFn({ data: { id: v.id, mode: "full", acknowledge_duplicate: !!v.acknowledge } }),
    onSuccess: () => {
      setDupQueue(null);
      toast.success("Working at the portal now — the claim number will be saved automatically.");
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
      qc.invalidateQueries({ queryKey: ["submission_queue"] });
    },
    onError: (e: any, v) => {
      const dup = parseDuplicateClaimError(e);
      if (dup) {
        setDupQueue({ id: v.id, info: dup });
        return;
      }
      toast.error(e?.message ?? "Could not start the submission");
    },
  });


  if (!rows.length)
    return (
      <EmptyState message="No trips currently waiting for portal submission." />
    );

  return (
    <>
      <DuplicateSubmitDialog
        info={dupQueue?.info ?? null}
        busy={oneShot.isPending}
        onCancel={() => setDupQueue(null)}
        onConfirm={() => {
          if (dupQueue) oneShot.mutate({ id: dupQueue.id, acknowledge: true });
        }}
      />

      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-border bg-surface p-4 shadow-soft"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="font-medium">{r.passenger_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {r.medicaid_id} · Driver {r.driver_name} ·{" "}
                  {formatDateTime(r.pickup_at)}
                </div>
                {r.status === "pending_submit" && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-info/10 p-2 text-xs text-info">
                    <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Waiting to be sent. Submitting runs one job that fills, submits
                      and confirms on the portal, then saves the real claim number.
                    </span>
                  </div>
                )}
                <QueueBadge info={queueById.get(r.id)} />
              </button>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-col sm:items-end">
                <PdfCell
                  pdfUrl={r.pdf_url}
                  passengerName={r.passenger_name}
                  onPreview={onPreviewPdf}
                />
                {r.status === "pending_submit" && (
                  <>
                    <Button
                      size="sm"
                      disabled={oneShot.isPending || REAL_SUBMISSIONS_PAUSED}
                      onClick={() => oneShot.mutate({ id: r.id })}
                    >
                      {oneShot.isPending && oneShot.variables?.id === r.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-1 h-4 w-4" />
                      )}
                      {REAL_SUBMISSIONS_PAUSED ? "Submission paused" : "Submit to portal"}
                    </Button>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground underline underline-offset-2"
                      onClick={() => setConfirmFor(r)}
                    >
                      Submitted manually? Enter claim number
                    </button>
                  </>
                )}

                {queueById.get(r.id)?.cancellable === false ? (
                  <span className="text-[11px] text-muted-foreground">
                    Already submitted — cannot be cancelled
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setCancelFor(r)}>
                    <Ban className="mr-1 h-4 w-4" /> Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <MarkSubmittedDialog
        row={confirmFor}
        onClose={() => setConfirmFor(null)}
      />
      <CancelSubmissionDialog row={cancelFor} onClose={() => setCancelFor(null)} />
    </>
  );
}

/** Live queue position / progress for a claim the robot is working on. */
function QueueBadge({ info }: { info?: any }) {
  // Elapsed time is derived from the job's real start timestamp and re-rendered
  // on a local clock, so it can never sit frozen on the number that happened to
  // be true at the last fetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(id);
  }, []);

  if (!info) return null;
  const tone =
    info.queue_state === "queued"
      ? "bg-amber-500/10 text-amber-600"
      : info.queue_state === "running"
        ? "bg-info/10 text-info"
        : "bg-muted text-muted-foreground";

  const startedMs = info.started_at ? new Date(info.started_at).getTime() : null;
  const elapsedMin = startedMs
    ? Math.max(0, Math.round((now - startedMs) / 60000))
    : (info.elapsed_minutes ?? null);
  // The automation service hard-kills a job at 8 minutes.
  const overdue = elapsedMin != null && elapsedMin >= 8 && info.queue_state === "running";

  return (
    <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <Clock className="h-3.5 w-3.5" />
      {info.queue_label}
      {elapsedMin != null && info.queue_state !== "awaiting_review" && (
        <span className="opacity-70">· {elapsedMin}m elapsed</span>
      )}
      {overdue && <span className="opacity-70">· checking result…</span>}
    </div>
  );
}


/**
 * Cancelling is only ever allowed before the real Medicaid submit. The server
 * re-checks and refuses when a real claim number already exists.
 */
function CancelSubmissionDialog({ row, onClose }: { row: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelSubmission);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [row?.id]);

  const cancel = useMutation({
    mutationFn: async () => {
      try {
        return await cancelFn({ data: { id: row!.id } });
      } catch (e) {
        // The server function sometimes fails at the edge; billing staff have
        // RLS access to do the exact same update straight from the browser.
        if (looksLikeEdgeFailure(e)) return await cancelSubmissionClient(row!.id);
        throw e;
      }
    },
    onSuccess: () => {
      toast.success("Submission cancelled — the trip is back in Ready to Submit");
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
      qc.invalidateQueries({ queryKey: ["submission_queue"] });
      onClose();
    },
    onError: (e: unknown) => setError(friendlyErrorMessage(e, "Could not cancel this submission")),
  });


  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this submission?</DialogTitle>
          <DialogDescription>
            {row?.passenger_name ?? "This trip"} will go back to “Ready to Submit” so you can
            review, edit, or resubmit it later. Nothing is sent to Medicaid.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            No, keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
          >
            {cancel.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Yes, cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkSubmittedDialog({
  row,
  onClose,
}: {
  row: any | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const markFn = useServerFn(markPortalSubmitted);
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [row?.id]);

  const mark = useMutation({
    mutationFn: () =>
      markFn({
        data: { id: row!.id, confirmation_number: value.trim() },
      }),
    onSuccess: () => {
      toast.success("Marked as submitted");
      qc.invalidateQueries({ queryKey: ["billing_list"] });
      qc.invalidateQueries({ queryKey: ["billing_counts"] });
      qc.invalidateQueries({ queryKey: ["billing_detail"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fallback: manual claim number</DialogTitle>
          <DialogDescription>
            Only use this if the claim had to be submitted by hand in the HCPF portal
            (for example after an automation error). The normal path is Review &amp;
            Confirm, which submits and records the claim number automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Confirmation / Receipt Number
          </label>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 202607177245312"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim() && !mark.isPending) {
                mark.mutate();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mark.mutate()}
            disabled={!value.trim() || mark.isPending}
          >
            {mark.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- TAB 4: Submitted ------------------------------- */

function SubmittedTab({
  rows,
  onOpen,
  onPreviewPdf,
}: {
  rows: any[];
  onOpen: (id: string) => void;
  onPreviewPdf: (p: { url: string; filename: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [cancelFor, setCancelFor] = useState<any | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const conf = (r.state_confirmation_number ?? "").toLowerCase();
      const name = (r.passenger_name ?? "").toLowerCase();
      const submitted = (r.submitted_at ?? "").toLowerCase();
      const pickup = (r.pickup_at ?? "").toLowerCase();
      return (
        conf.includes(needle) ||
        name.includes(needle) ||
        submitted.includes(needle) ||
        pickup.includes(needle)
      );
    });
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by confirmation #, passenger, or date"
          className="pl-9"
        />
      </div>
      {!filtered.length ? (
        <EmptyState
          message={
            q ? "No submissions match that search." : "No submitted claims yet."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Passenger</th>
                <th className="px-4 py-3 text-left">Trip date</th>
                <th className="px-4 py-3 text-left">Submitted</th>
                <th className="px-4 py-3 text-left">Confirmation #</th>
                <th className="px-4 py-3 text-left">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-accent/60"
                  onClick={() => onOpen(r.id)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.passenger_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.medicaid_id}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDateTime(r.pickup_at)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.submitted_at ? formatDateTime(r.submitted_at) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-success/10 px-2 py-1 font-mono text-xs font-semibold text-success">
                      {r.state_confirmation_number ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <PdfCell
                        pdfUrl={r.pdf_url}
                        passengerName={r.passenger_name}
                        onPreview={onPreviewPdf}
                      />
                      <Button size="sm" variant="ghost" onClick={() => setCancelFor(r)}>
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CancelSubmissionDialog row={cancelFor} onClose={() => setCancelFor(null)} />
    </div>
  );
}
