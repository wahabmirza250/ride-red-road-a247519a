import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Deck } from "@/components/showcase/Deck";

const searchSchema = z.object({
  slide: fallback(z.number().int(), 0).default(0),
  step: fallback(z.number().int(), 0).default(0),
});

export const Route = createFileRoute("/showcase")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "NEMT Solutions Platform — Product Walkthrough" },
      {
        name: "description",
        content:
          "An animated, step-by-step walkthrough of the NEMT Solutions platform: passenger booking, driver app, dispatch, Medicaid billing, admin and owner tools.",
      },
      { property: "og:title", content: "NEMT Solutions Platform — Product Walkthrough" },
      {
        property: "og:description",
        content:
          "See every NEMT Solutions app in action: booking, dispatch, driver trips, AI paper-bill billing, admin dashboards and multi-company owner controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShowcasePage,
});

function ShowcasePage() {
  const { slide, step } = Route.useSearch();
  const navigate = useNavigate({ from: "/showcase" });

  return (
    <Deck
      slideIndex={slide}
      stepIndex={step}
      onGo={(s, st) =>
        navigate({ search: { slide: s, step: st }, replace: true, resetScroll: false })
      }
    />
  );
}
