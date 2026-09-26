import { createFileRoute } from "@tanstack/react-router";
import { OfficeManaged } from "@/components/driver/OfficeManaged";
export const Route = createFileRoute("/$companySlug/driver/expenses")({ component: OfficeManaged });
