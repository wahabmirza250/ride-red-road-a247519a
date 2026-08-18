import { useEffect } from "react";
import { supabase } from "@/lib/supabaseBrowser";

/**
 * Authoritative company slug of the CURRENTLY signed-in account, resolved from
 * the account itself (profile -> company) and never from the URL.
 *
 * Returns null when the account has no company link. Callers must treat null
 * as "cannot route" — falling back to a slug taken from the address bar would
 * let a user land on another tenant's URL space, even if only briefly.
 */
export async function resolveOwnCompanySlug(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getUser();
  const userId = sess.user?.id;
  if (!userId) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.company_id) return null;
  const { data: co } = await supabase
    .from("companies")
    .select("url_slug, status")
    .eq("id", prof.company_id)
    .maybeSingle();
  if (!co || co.status !== "active") return null;
  return co.url_slug as string;
}

/**
 * "Already signed in" redirect for the sign-in screens. The destination is
 * always built from the account's OWN company, so opening another company's
 * sign-in URL while signed in can never bounce into that company's URL space.
 */
export function useOwnCompanyRedirect(enabled: boolean, appPath: string) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    resolveOwnCompanySlug().then((slug) => {
      if (cancelled || !slug) return;
      window.location.replace(`/${slug}${appPath}`);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, appPath]);
}

/** Message shown when a valid account has no usable company link. */
export const NO_COMPANY_MESSAGE =
  "Your account isn't linked to an active provider. Contact your administrator.";
