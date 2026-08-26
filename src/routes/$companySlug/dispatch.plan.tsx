import { createFileRoute } from "@tanstack/react-router";
import { PlanRidesPanel } from "@/components/dispatch/PlanRidesPanel";

export const Route = createFileRoute("/$companySlug/dispatch/plan")({
  component: PlanRidesPanel,
});
