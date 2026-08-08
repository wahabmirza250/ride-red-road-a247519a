import { createFileRoute } from "@tanstack/react-router";
import { DriverSignInScreen } from "@/components/auth/DriverSignInScreen";

export const Route = createFileRoute("/$companySlug/driver/signin")({
  component: Page,
});

function Page() {
  const { companySlug } = Route.useParams();
  return <DriverSignInScreen companySlug={companySlug} />;
}
