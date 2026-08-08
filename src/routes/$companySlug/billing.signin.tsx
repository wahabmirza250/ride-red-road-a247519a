import { createFileRoute } from "@tanstack/react-router";
import { BillingSignInScreen } from "@/components/auth/BillingSignInScreen";

export const Route = createFileRoute("/$companySlug/billing/signin")({
  ssr: false,
  component: Page,
});

function Page() {
  const { companySlug } = Route.useParams();
  return <BillingSignInScreen companySlug={companySlug} />;
}
