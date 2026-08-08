import { createFileRoute } from "@tanstack/react-router";
import { BillingWorkspace } from "@/components/billing/BillingWorkspace";

export const Route = createFileRoute("/$companySlug/billing/")({
  component: BillingWorkspace,
});
