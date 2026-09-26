import { createFileRoute } from "@tanstack/react-router";
import { BillingSetupPanel } from "@/components/billing/BillingSetupPanel";
import { AppLink } from '@/lib/appLink';

export const Route = createFileRoute("/$companySlug/billing/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Billing settings — NEMT Solutions Billing" },
      {
        name: "description",
        content:
          "Attach or remove state portal logins, choose the default portal, and manage trip and mileage rates.",
      },
      { property: "og:title", content: "Billing settings — NEMT Solutions Billing" },
      {
        property: "og:description",
        content: "Manage portal credentials and billing rates for your company.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Billing settings</h1>
        <p className="text-sm text-muted-foreground">
          Attach or remove state portal logins, pick the default portal for submissions, and keep
          your trip and mileage rates up to date.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-semibold">Electronic billing (EDI)</h2>
        <p className="mt-1 text-sm text-muted-foreground">Connect your provider profile, review electronic claims, and track payer responses.</p>
        <AppLink to="/billing/edi" className="mt-3 inline-flex text-sm font-medium text-primary underline">Open EDI workspace</AppLink>
      </section>
      <BillingSetupPanel />
    </div>
  );
}
