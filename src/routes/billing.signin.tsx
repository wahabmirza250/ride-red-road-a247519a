import { createFileRoute } from "@tanstack/react-router";
import { BillingSignInScreen } from "@/components/auth/BillingSignInScreen";
export const Route = createFileRoute("/billing/signin")({ component: BillingSignInScreen });
