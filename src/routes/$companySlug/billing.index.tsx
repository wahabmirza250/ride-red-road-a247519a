import { createFileRoute } from "@tanstack/react-router";
import { SuperEdiWorkspace } from "@/components/billing/superedi/SuperEdiWorkspace";
export const Route = createFileRoute("/$companySlug/billing/")({
  ssr: false,
  component: () => <SuperEdiWorkspace billingApp />,
});
