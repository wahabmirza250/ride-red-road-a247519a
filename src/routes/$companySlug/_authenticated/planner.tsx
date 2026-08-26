import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Ride planning now lives inside the Dispatch workspace. Old Planner bookmarks
 * are forwarded to the operations view that hosts the "Plan rides" tab.
 */
export const Route = createFileRoute("/$companySlug/_authenticated/planner")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$companySlug/live-ops",
      params: { companySlug: params.companySlug },
      search: { tab: "plan" },
      replace: true,
    });
  },
});
