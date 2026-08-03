import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/$companySlug/$companySlug/dispatch/routes")({
  component: () => <Outlet />,
});
