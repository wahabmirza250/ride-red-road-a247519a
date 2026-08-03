import { createFileRoute } from "@tanstack/react-router";
import { APP_PREFIXES } from "@/lib/appLink";
import { BareRouteRedirect } from "@/components/BareRouteRedirect";
import { CompanyLinkRequired } from "@/components/CompanyLinkRequired";

export const Route = createFileRoute("/$companySlug/$")({
  ssr: false,
  component: CompanyCatchAll,
});

function CompanyCatchAll() {
  const { companySlug, _splat } = Route.useParams();
  const rest = (_splat ?? "").replace(/^\/+/, "");

  // Legacy bare URL such as /driver/history — forward to the caller's own
  // company URL (server-resolved).
  if (APP_PREFIXES.has(companySlug)) {
    return <BareRouteRedirect prefix={companySlug} rest={rest ? `/${rest}` : ""} />;
  }

  // Valid-looking company slug but an unknown page under it.
  return (
    <CompanyLinkRequired
      title="Page not found"
      message="This link doesn't point to a page in your provider's app. Open the link your provider gave you, or sign in to your account."
    />
  );
}
