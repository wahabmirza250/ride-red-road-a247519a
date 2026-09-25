import { createFileRoute } from "@tanstack/react-router";
import { CompanyEntry } from "@/components/auth/CompanyEntry";
export const Route = createFileRoute("/access")({ component: () => <CompanyEntry /> });
