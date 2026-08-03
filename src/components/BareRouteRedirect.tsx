import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanySlug } from "@/lib/companyContext";
import { getMyCompany } from "@/lib/companyPublic.functions";
import { CompanyLinkRequired } from "@/components/CompanyLinkRequired";

/**
 * Legacy bare URLs (`/dashboard`, `/driver/history`, ...) no longer host the
 * app — every app route lives under `/{companySlug}/...`. Signed-in users are
 * forwarded to their OWN company's equivalent URL (resolved server-side, never
 * from the URL), guests are sent to the right sign-in screen or the neutral
 * "provider link required" gate.
 */
export function BareRouteRedirect({ prefix, rest }: { prefix: string; rest: string }) {
  const { user, loading } = useAuth();
  const myCompany = useServerFn(getMyCompany);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    if (!user) {
      if (prefix === "driver") return void window.location.replace("/driver/signin");
      if (prefix === "dispatch") return void window.location.replace("/dispatch/signin");
      if (prefix === "passenger") {
        const stored = getCompanySlug();
        if (stored) return void window.location.replace(`/${stored}/passenger${rest}`);
        setStuck(true);
        return;
      }
      return void window.location.replace("/auth");
    }

    myCompany({})
      .then((r) => {
        if (cancelled) return;
        if (r.slug) window.location.replace(`/${r.slug}/${prefix}${rest}`);
        else setStuck(true);
      })
      .catch(() => !cancelled && setStuck(true));

    return () => {
      cancelled = true;
    };
  }, [loading, user, prefix, rest, myCompany]);

  if (stuck) return <CompanyLinkRequired />;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
