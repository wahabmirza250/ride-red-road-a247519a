import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/lib/appLink";
import { useAuth } from "@/lib/auth";
import { getBillingCounts, getBillingSettings } from "@/lib/billing.functions";
import { getBillingCountsClient } from "@/lib/billingClient";
import { getPortal } from "@/lib/portals";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";

export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-billing")({
  component: MedicaidBillingSummary,
});

const CARDS = [
  { key: "pending_review", label: "Pending review" },
  { key: "approved", label: "Ready to submit" },
  { key: "submitting", label: "Robot running" },
  { key: "pending_submit", label: "Awaiting portal submission" },
  { key: "submitted", label: "Submitted" },
  { key: "needs_fix", label: "Needs fix" },
] as const;

/**
 * Admin-side read-only overview. The working billing tools now live in the
 * dedicated Billing app at /{slug}/billing.
 */
function MedicaidBillingSummary() {
  const { isAdmin } = useAuth();
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
    enabled: isAdmin,
    refetchInterval: 30000,
  });

  const settings = useQuery({
    queryKey: ["billing_settings"],
    queryFn: () => settingsFn(),
    enabled: isAdmin,
  });
  const defaultPortal = getPortal(settings.data?.default_portal_id);

  if (!isAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div className="surface-red space-y-6">
      <PageHeader
        title="Medicaid Billing"
        description="Status overview. Billing staff do the day-to-day work in the dedicated Billing app."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild className="rounded-full">
          <AppLink to="/billing">
            Open Billing app <ArrowUpRight className="ml-1 h-4 w-4" />
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
