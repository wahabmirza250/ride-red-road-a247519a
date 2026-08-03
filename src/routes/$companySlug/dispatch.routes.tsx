import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/$companySlug/dispatch/routes")({
  component: () => <Outlet />,
});
