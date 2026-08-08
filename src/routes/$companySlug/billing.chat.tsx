import { createFileRoute } from "@tanstack/react-router";
import { PaperBillChat } from "@/components/billing/PaperBillChat";

export const Route = createFileRoute("/$companySlug/billing/chat")({
  component: PaperBillChat,
});
