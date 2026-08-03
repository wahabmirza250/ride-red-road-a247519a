import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { APP_PREFIXES } from "@/lib/appLink";
import { BareRouteRedirect } from "@/components/BareRouteRedirect";

export const Route = createFileRoute("/$companySlug/")({
  ssr: false,
  component: CompanyHome,
});

function CompanyHome() {
  const { companySlug } = Route.useParams();
  const isBareLegacy = APP_PREFIXES.has(companySlug);

  useEffect(() => {
    if (!isBareLegacy) window.location.replace(`/${companySlug}/passenger`);
  }, [companySlug, isBareLegacy]);

  if (isBareLegacy) return <BareRouteRedirect prefix={companySlug} rest="" />;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
