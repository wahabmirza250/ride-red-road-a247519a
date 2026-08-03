import { createFileRoute } from "@tanstack/react-router";
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
  getBillingCounts,
  getBillingSettings,
  listBillingRecords,
  markPortalSubmitted,
  startRobotForRecord,
} from "@/lib/billing.functions";
import { getPortal } from "@/lib/portals";
import { BillingDetailSheet } from "@/components/billing/BillingDetailSheet";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";
import { ClaimsHistoryTab } from "@/components/billing/ClaimsHistoryTab";

import { getBillingCountsClient, listBillingRecordsClient } from "@/lib/billingClient";

export const Route = createFileRoute("/$companySlug/$companySlug/_authenticated/medicaid-billing")({
  component: MedicaidBillingPage,
});

type TabKey = "pending_review" | "ready_to_submit" | "awaiting_portal" | "submitted" | "claims_history";

const TABS: {
  key: TabKey;
  label: string;
  statuses: (
    | "pending_review"
    | "approved"
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
    statuses: ["approved", "submitting", "needs_fix"],
    countKeys: ["approved", "submitting", "needs_fix"],
  },
  {
    key: "awaiting_portal",
    label: "Awaiting Portal Submission",
    statuses: ["pending_submit"],
    countKeys: ["pending_submit"],
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


function MedicaidBillingPage() {
  const { isAdmin } = useAuth();
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
    enabled: isAdmin,
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
    enabled: isAdmin,
    refetchInterval: 20000,
  });


  const settings = useQuery({
    queryKey: ["billing_settings"],
    queryFn: () => settingsFn(),
    enabled: isAdmin,
  });
  const defaultPortal = getPortal(settings.data?.default_portal_id);

  // Realtime — invalidate on any billing_records change
  useEffect(() => {
    const ch = supabase
      .channel("billing_records_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "billing_records" },
        () => {
          qc.invalidateQueries({ queryKey: ["billing_list"] });
          qc.invalidateQueries({ queryKey: ["billing_detail"] });
          qc.invalidateQueries({ queryKey: ["billing_counts"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  function countFor(key: TabKey) {
    const t = TABS.find((x) => x.key === key)!;
    if (!counts.data || t.countKeys.length === 0) return null;
    return t.countKeys.reduce((sum, k) => sum + (counts.data![k] ?? 0), 0);
  }


  if (!isAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div className="surface-red space-y-6">
      <PageHeader
        title="Medicaid Billing"
        description="Review driver-submitted trips, batch-send them to the automation robot, then confirm the state's receipt number after human portal submission."
      />

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

      {defaultPortal && (
        <div className="text-xs text-muted-foreground">
          Billing through <strong>{defaultPortal.name}</strong> · {defaultPortal.state}
        </div>
      )}

      <BillingRatesCard />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex-wrap">
          {TABS.map((t) => {
            const c = countFor(t.key);
            return (
              <TabsTrigger key={t.key} value={t.key}>
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
  if (!rows.length)
    return <EmptyState message="No trips awaiting review." />;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());

  const selectableIds = useMemo(
    () =>
      rows
        .filter((r) => r.status === "approved" || r.status === "needs_fix")
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

  async function submitSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSubmittingIds((prev) => new Set([...prev, ...ids]));
    let ok = 0;
    let failed = 0;
    // Loop serially so we get an individual error per trip and don't flood
    // the automation service with parallel logins.
    for (const id of ids) {
      try {
        await startFn({ data: { id } });
        ok += 1;
      } catch (e: any) {
        failed += 1;
        toast.error(`Trip ${id.slice(0, 8)}…: ${e?.message ?? "Failed"}`);
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
    setSelected(new Set());
    if (ok) toast.success(`Started ${ok} robot job${ok === 1 ? "" : "s"}`);
    if (!failed && !ok) toast.message("Nothing to submit.");
  }

  if (!rows.length)
    return <EmptyState message="No approved trips waiting to be sent to the robot." />;

  return (
    <div className="space-y-3">
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

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        <table className="w-full text-sm">
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
                    {isRunning ? (
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
  const [confirmFor, setConfirmFor] = useState<any | null>(null);

  if (!rows.length)
    return (
      <EmptyState message="No trips currently waiting for portal submission." />
    );

  return (
    <>
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
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-info/10 p-2 text-xs text-info">
                  <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Claim is filled in the HCPF portal — log in, review, and click
                    Submit there. Then paste the confirmation number below.
                  </span>
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <PdfCell
                  pdfUrl={r.pdf_url}
                  passengerName={r.passenger_name}
                  onPreview={onPreviewPdf}
                />
                <Button size="sm" onClick={() => setConfirmFor(r)}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Mark as Submitted
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <MarkSubmittedDialog
        row={confirmFor}
        onClose={() => setConfirmFor(null)}
      />
    </>
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
          <DialogTitle>Mark as Submitted</DialogTitle>
          <DialogDescription>
            Enter the confirmation/receipt number the HCPF portal returned after
            you clicked Submit and Confirm.
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
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <table className="w-full text-sm">
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
      )}
    </div>
  );
}
