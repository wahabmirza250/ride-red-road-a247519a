import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { APP_PREFIXES } from "@/lib/appLink";
import { BareRouteRedirect } from "@/components/BareRouteRedirect";
import { BrandWordmark } from "@/components/Brand";
import { COMPANY_APPS, companyAppHref } from "@/lib/companyAccess";
export const Route = createFileRoute("/$companySlug/")({ ssr: false, component: CompanyHome });
function CompanyHome() {
  const { companySlug } = Route.useParams();
  if (APP_PREFIXES.has(companySlug)) return <BareRouteRedirect prefix={companySlug} rest="" />;
  return <main className="min-h-dvh bg-background px-4 py-10 sm:py-16">
    <div className="mx-auto max-w-3xl">
      <a href="/" className="inline-flex"><BrandWordmark className="h-10" /></a>
      <p className="mt-10 text-sm font-medium text-primary">Company code: {companySlug}</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Choose your app</h1>
      <p className="mt-3 text-muted-foreground">Use the login your administrator gave you. Your account opens the apps assigned to you.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {COMPANY_APPS.map(app => <a key={app.key} href={companyAppHref(companySlug, app.key)} className="group flex items-center justify-between gap-4 rounded-2xl border bg-surface p-6 shadow-sm transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <div><h2 className="text-lg font-semibold">{app.label}</h2><p className="mt-1 text-sm text-muted-foreground">{app.description}</p></div><ArrowRight className="h-5 w-5 shrink-0 text-primary" />
        </a>)}
      </div>
      <a href="/access" className="mt-8 inline-block text-sm text-muted-foreground hover:underline">Use a different company code</a>
    </div>
  </main>;
}
