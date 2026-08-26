import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Games feature was retired. Old links land on the passenger home. */
export const Route = createFileRoute("/$companySlug/passenger/games")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$companySlug/passenger",
      params: { companySlug: params.companySlug },
      replace: true,
    });
  },
});
