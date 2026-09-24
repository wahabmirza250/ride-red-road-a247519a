import { createFileRoute } from "@tanstack/react-router";
import { DriverPayroll } from "@/components/driver/DriverPayroll";
export const Route = createFileRoute("/$companySlug/driver/earnings")({ component: DriverPayroll });
