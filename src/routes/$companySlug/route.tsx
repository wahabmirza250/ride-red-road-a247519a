import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { APP_PREFIXES } from "@/lib/appLink";
import { setCompanySlug } from "@/lib/companyContext";
import { getMyCompany, resolveCompanySlug } from "@/lib/companyPublic.functions";
import { CompanyLinkRequired } from "@/components/CompanyLinkRequired";

/**
 * Tenant layout. Every app URL is `/{companySlug}/...`.
 *
 * The slug is never trusted: for a signed-in user it is compared against the
 * company resolved SERVER-SIDE from their account, and any mismatch is
 * replaced with their own company's URL before children mount. Guests get the
 * public branding lookup only (booking flow), and an unknown/suspended slug
 * falls back to the neutral CompanyLinkRequired gate.
 */
export const Route = createFileRoute("/$companySlug")({
  ssr: false,
  component: CompanyLayout,
});

type State = "loading" | "ok" | "bad" | "suspended" | "nocompany";

function CompanyLayout() {
  const { companySlug } = Route.useParams();
  const isBareLegacy = APP_PREFIXES.has(companySlug);
  const { user, loading } = useAuth();
  const userId = user?.id;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Guest-facing routes (passenger booking, sign-in pages) are resolved STRICTLY
  // from the URL slug. They must never inherit company context from a staff /
  // owner session, otherwise /london/passenger bounces to /walla/passenger.
  const isPublicRoute = (() => {
    const rest = pathname.split("/").slice(2).join("/");
    return (
      rest === "" ||
      rest.startsWith("passenger") ||
      rest === "login" ||
      rest.endsWith("signin") ||
      rest.endsWith("signup")
    );
  })();
  const myCompany = useServerFn(getMyCompany);
  const resolve = useServerFn(resolveCompanySlug);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (isBareLegacy) return; // handled by the index / splat children
    if (loading) return;
    let cancelled = false;

    (async () => {
      try {
        if (userId && !isPublicRoute) {
          let mine: Awaited<ReturnType<typeof myCompany>> | undefined;
          for (let attempt = 0; attempt < 2 && !mine; attempt += 1) {
            try {
              mine = await myCompany({});
            } catch (error) {
              if (attempt === 1) throw error;
              await new Promise((resolveRetry) => window.setTimeout(resolveRetry, 500));
            }
          }
          if (cancelled) return;
          if (!mine) return setState("bad");
          if (!mine.slug) return setState("nocompany");
          if (!mine.active) return setState("suspended");
          if (mine.slug !== companySlug) {
            const rest = window.location.pathname.split("/").slice(2).join("/");
            window.location.replace(
              `/${mine.slug}${rest ? `/${rest}` : ""}${window.location.search}`,
            );
            return;
          }
          setCompanySlug(mine.slug);
          return setState("ok");
        }

        const r = await resolve({ data: { slug: companySlug } });
        if (cancelled) return;
        if (!r.found) return setState("bad");
        if (!r.active) return setState("suspended");
        setCompanySlug(r.url_slug);
        setState("ok");
      } catch {
        if (!cancelled) setState("bad");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companySlug, isBareLegacy, loading, userId, isPublicRoute, myCompany, resolve]);

  if (isBareLegacy) return <Outlet />;

  if (state === "ok") return <Outlet />;

  if (state === "suspended")
    return (
      <CompanyLinkRequired
        title="This provider account is unavailable"
        message="This transportation provider's account is currently suspended. Please contact them directly for assistance."
      />
    );

  if (state === "nocompany")
    return (
      <CompanyLinkRequired
        title="Your account isn't linked to a company"
        message="Ask your administrator to link your account to a transportation provider, then sign in again."
      />
    );

  if (state === "bad") return <CompanyLinkRequired />;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
