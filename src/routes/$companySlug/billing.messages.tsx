import { createFileRoute } from "@tanstack/react-router";
import { StaffMessages } from "@/components/billing/StaffMessages";

export const Route = createFileRoute("/$companySlug/billing/messages")({
  component: StaffMessages,
});
