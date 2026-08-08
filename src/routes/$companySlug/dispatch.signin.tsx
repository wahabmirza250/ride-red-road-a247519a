import { createFileRoute } from "@tanstack/react-router";
import { DispatchSignInScreen } from "@/components/auth/DispatchSignInScreen";

export const Route = createFileRoute("/$companySlug/dispatch/signin")({
  component: Page,
});

function Page() {
  const { companySlug } = Route.useParams();
  return <DispatchSignInScreen companySlug={companySlug} />;
}
