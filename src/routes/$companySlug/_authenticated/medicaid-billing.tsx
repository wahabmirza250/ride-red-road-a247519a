import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for the two billing methods. Medical Billing no longer drops the user
 * straight into one flow: the index route offers the choice, and the children
 * host the legacy HCPF/robot workspace and the new Super EDI workspace.
 */
export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-billing")({
  component: () => <Outlet />,
});
