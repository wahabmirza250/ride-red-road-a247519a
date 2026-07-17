import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Loader2, AlertCircle, AlertTriangle, HandMetal, Eye, FileDown } from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/format";
import {
  getBillingSettings,
  listBillingRecords,
} from "@/lib/billing.functions";
import { getPortal } from "@/lib/portals";
import { BillingDetailSheet } from "@/components/billing/BillingDetailSheet";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";


export const Route = createFileRoute("/_authenticated/medicaid-billing")({
  component: MedicaidBillingPage,
});

const TABS = [
  { key: "pending_review", label: "Pending Review" },
  { key: "pending_submit", label: "Pending Submit" },
  { key: "submitting", label: "Submitting" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "needs_fix", label: "Needs Fix" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function MedicaidBillingPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("pending_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null);

  const listFn = useServerFn(listBillingRecords);
  const rows = useQuery({
    queryKey: ["billing_list", tab],
    queryFn: () => listFn({ data: { status: tab } }),
    enabled: isAdmin,
  });

  const settingsFn = useServerFn(getBillingSettings);
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
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);



  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Admins only.</div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicaid Billing"
        description="Review driver-submitted trips, submit them to the state portal, and track results."
      />

      {!runnerConfigured && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Runner not configured</div>
            <div className="text-xs">
              Submissions will stay in <em>Pending Submit</em> until the
              automation service secrets (<code>AUTOMATION_SERVICE_URL</code>,{" "}
              <code>AUTOMATION_SERVICE_API_KEY</code>,{" "}
              <code>AUTOMATION_SERVICE_HMAC_SECRET</code>) are set.
            </div>
          </div>
        </div>
      )}

      {runnerConfigured && !defaultPortal && (
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
          Billing through <strong>{defaultPortal.name}</strong> ·{" "}
          {defaultPortal.state}
        </div>
      )}

      <BillingRatesCard />




      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "pending_submit" && (rows.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3">
          <Checkbox
            checked={checked.size === idsOnPage.length && idsOnPage.length > 0}
            onCheckedChange={(v) =>
              setChecked(new Set(v ? idsOnPage : []))
            }
          />
          <span className="text-xs text-muted-foreground">
            {checked.size} selected
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={checked.size === 0 || submitMany.isPending}
              onClick={() => submitMany.mutate(Array.from(checked))}
            >
              <Send className="mr-1 h-4 w-4" /> Submit selected
            </Button>
            <Button
              size="sm"
              disabled={idsOnPage.length === 0 || submitMany.isPending}
              onClick={() => submitMany.mutate(idsOnPage)}
            >
              {submitMany.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              <Send className="mr-1 h-4 w-4" /> Submit all
            </Button>
          </div>
        </div>
      )}

      {rows.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !rows.data?.length ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No trips in this queue.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {tab === "pending_submit" && (
                  <th className="w-10 px-3 py-3"></th>
                )}
                <th className="px-4 py-3 text-left">Passenger</th>
                <th className="px-4 py-3 text-left">Driver</th>
                <th className="px-4 py-3 text-left">Trip date</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">PDF</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.data.map((r: any) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-accent/60"
                  onClick={() => setSelectedId(r.id)}
                >
                  {tab === "pending_submit" && (
                    <td
                      className="px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked.has(r.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(checked);
                          if (v) next.add(r.id);
                          else next.delete(r.id);
                          setChecked(next);
                        }}
                      />
                    </td>
                  )}
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
                    {r.status === "submitting" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                        <Loader2 className="h-3 w-3 animate-spin" /> submitting
                      </span>
                    ) : (
                      <StatusPill status={r.status} />
                    )}
                    {r.requires_human_step && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                        <HandMetal className="h-3 w-3" />
                        <span className="truncate">
                          This portal needs a manual step to submit
                        </span>
                      </div>
                    )}
                    {r.submission_error && !r.requires_human_step && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        <span className="truncate">{r.submission_error}</span>
                      </div>
                    )}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.pdf_url ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPdfPreview({
                              url: r.pdf_url!,
                              filename: `trip-${(r.passenger_name ?? "rider").replace(/\s+/g, "_")}.pdf`,
                            })
                          }
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            downloadPdf(
                              r.pdf_url,
                              `trip-${(r.passenger_name ?? "rider").replace(/\s+/g, "_")}.pdf`,
                            )
                          }
                        >
                          <FileDown className="mr-1 h-3.5 w-3.5" /> PDF
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.state_confirmation_number && (
                      <span className="text-xs text-muted-foreground">
                        #{r.state_confirmation_number}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BillingDetailSheet
        id={selectedId}
        onClose={() => setSelectedId(null)}
      />
      <PdfPreviewDialog
        url={pdfPreview?.url ?? null}
        filename={pdfPreview?.filename ?? "trip.pdf"}
        onClose={() => setPdfPreview(null)}
      />
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

