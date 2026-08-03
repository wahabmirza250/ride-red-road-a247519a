import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { resolveCompanySlug } from "@/lib/companyPublic.functions";
import { setCompanySlug } from "@/lib/companyContext";
import { CompanyLinkRequired } from "@/components/CompanyLinkRequired";

export const Route = createFileRoute("/$companySlug/$")({
  ssr: false,
  component: CompanyEntry,
});

const APPS = ["passenger", "driver", "dispatch", "dashboard"];

function CompanyEntry() {
  const { companySlug, _splat } = Route.useParams();
  const resolve = useServerFn(resolveCompanySlug);
  const nav = useNavigate();
  const [state, setState] = useState<"loading" | "bad" | "suspended">("loading");

  useEffect(() => {
    let cancelled = false;
    const rest = (_splat ?? "").replace(/^\/+/, "");
    const app = rest.split("/")[0];
    if (!APPS.includes(app)) {
      setState("bad");
      return;
    }
    resolve({ data: { slug: companySlug } })
      .then((r) => {
        if (cancelled) return;
        if (!r.found) return setState("bad");
        if (!r.active) return setState("suspended");
        setCompanySlug(r.url_slug);
        const target = app === "dashboard" ? "/dashboard" : `/${rest}`;
        window.location.replace(target);
      })
      .catch(() => !cancelled && setState("bad"));
    return () => {
      cancelled = true;
    };
  }, [companySlug, _splat, resolve, nav]);

  if (state === "loading")
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (state === "suspended")
    return (
      <CompanyLinkRequired
        title="This provider account is unavailable"
        message="This transportation provider's account is currently suspended. Please contact them directly for assistance."
      />
    );

  return <CompanyLinkRequired />;
}
