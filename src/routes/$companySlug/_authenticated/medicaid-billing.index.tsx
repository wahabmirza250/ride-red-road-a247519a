import { createFileRoute } from "@tanstack/react-router";
import { SuperEdiWorkspace } from "@/components/billing/superedi/SuperEdiWorkspace";
export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-billing/")({
  ssr: false,
  component: () => <SuperEdiWorkspace />,
});
