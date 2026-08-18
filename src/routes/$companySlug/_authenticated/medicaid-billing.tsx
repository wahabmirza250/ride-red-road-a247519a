import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLink } from "@/lib/appLink";
import { useAuth } from "@/lib/auth";
import { getBillingCounts, getBillingSettings } from "@/lib/billing.functions";
import { getBillingCountsClient } from "@/lib/billingClient";
import { getPortal } from "@/lib/portals";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";
import { BillingWorkspace } from "@/components/billing/BillingWorkspace";
import { PaperBillChat } from "@/components/billing/PaperBillChat";
import { BatchPaperBills } from "@/components/billing/BatchPaperBills";

export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-billing")({
  head: () => ({
    meta: [
      { title: "Medicaid Billing — RedArt NEMT" },
      {
        name: "description",
        content:
          "Admin billing workspace: review paper bills, confirm claims, submit to the state portal and track claims history without leaving the dashboard.",
      },
      { property: "og:title", content: "Medicaid Billing — RedArt NEMT" },
      {
        property: "og:description",
        content: "Full Medicaid billing workflow inside the admin dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminBillingPage,
});

const CARDS = [
  { key: "pending_review", label: "Pending review" },
  { key: "approved", label: "Ready to submit" },
  { key: "submitting", label: "Robot running" },
  { key: "pending_submit", label: "Awaiting portal submission" },
  { key: "submitted", label: "Submitted" },
  { key: "needs_fix", label: "Needs fix" },
] as const;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "workflow", label: "Workflow & claims" },
  { key: "paper", label: "Paper bills" },
  { key: "batch", label: "Batch upload" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Admin-side billing. Admins see every bill in the company, so the full
 * billing toolset (paper bill chat, ready-to-submit queue, claims history)
 * is embedded here as well as in the standalone Billing app.
 */
function AdminBillingPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");

  if (!isAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div className="surface-red space-y-6">
      <PageHeader
        title="Medicaid Billing"
        description="Review, confirm and submit bills without leaving the admin dashboard."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap sm:flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="shrink-0 whitespace-nowrap">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "overview" && <BillingOverview />}
      {tab === "workflow" && <BillingWorkspace embedded />}
      {tab === "paper" && <PaperBillChat />}
      {tab === "batch" && <BatchPaperBills />}
    </div>
  );
}

function BillingOverview() {
  const countsFn = useServerFn(getBillingCounts);
  const settingsFn = useServerFn(getBillingSettings);

  const counts = useQuery({
    queryKey: ["billing_counts"],
    queryFn: async () => {
      try {
        return await countsFn();
      } catch {
        return await getBillingCountsClient();
      }
    },
    refetchInterval: 30000,
  });

  const settings = useQuery({
    queryKey: ["billing_settings"],
    queryFn: () => settingsFn(),
  });
  const defaultPortal = getPortal(settings.data?.default_portal_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" className="rounded-full">
          <AppLink to="/billing">
            Open standalone Billing app <ArrowUpRight className="ml-1 h-4 w-4" />
          </AppLink>
        </Button>
        {defaultPortal && (
          <span className="text-xs text-muted-foreground">
            Billing through <strong>{defaultPortal.name}</strong> · {defaultPortal.state}
          </span>
        )}
      </div>

      {counts.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <div key={c.key} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {counts.data?.[c.key] ?? 0}
              </div>
            </div>
          ))}
        </div>
      )}

      <BillingRatesCard />
    </div>
  );
}
