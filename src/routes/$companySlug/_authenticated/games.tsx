import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Games feature was retired. Old links land on the dashboard. */
export const Route = createFileRoute("/$companySlug/_authenticated/games")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$companySlug/dashboard",
      params: { companySlug: params.companySlug },
      replace: true,
    });
  },
});
