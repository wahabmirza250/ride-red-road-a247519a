import { createFileRoute } from "@tanstack/react-router";
import { AdminSignInScreen } from "@/components/auth/AdminSignInScreen";

export const Route = createFileRoute("/$companySlug/login")({
  ssr: false,
  component: Page,
});

function Page() {
  const { companySlug } = Route.useParams();
  return <AdminSignInScreen companySlug={companySlug} />;
}
