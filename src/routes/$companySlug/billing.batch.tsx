import { createFileRoute } from "@tanstack/react-router";
import { BatchPaperBills } from "@/components/billing/BatchPaperBills";

export const Route = createFileRoute("/$companySlug/billing/batch")({
  component: BatchPaperBills,
});
