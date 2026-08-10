import { createFileRoute } from "@tanstack/react-router";
import { PortalCredentialsCard } from "@/components/billing/PortalCredentialsCard";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";

export const Route = createFileRoute("/$companySlug/billing/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Billing settings — RedArt Billing" },
      {
        name: "description",
        content:
          "Attach or remove state portal logins, choose the default portal, and manage trip and mileage rates.",
      },
      { property: "og:title", content: "Billing settings — RedArt Billing" },
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

      <PortalCredentialsCard />
      <BillingRatesCard />
    </div>
  );
}
