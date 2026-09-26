import { createFileRoute } from "@tanstack/react-router";
import { OfficeManaged } from "@/components/driver/OfficeManaged";
export const Route = createFileRoute("/$companySlug/driver/earnings")({ component: OfficeManaged });
