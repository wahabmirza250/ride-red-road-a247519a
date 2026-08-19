import { supabase } from "@/lib/supabaseBrowser";
import type { AppRole } from "@/lib/auth";

const LABEL: Record<AppRole, string> = {
  admin: "an admin/owner",
  driver: "a driver",
  passenger: "a passenger",
  dispatch: "a dispatcher",
  billing: "a billing specialist",
  admin_biller: "an admin biller",
  platform_owner: "a platform owner",
};

const SESSION_HYDRATION_DELAYS_MS = [0, 250, 600, 1200] as const;

async function wait(ms: number) {
  if (ms > 0) await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readRolesAfterSignIn(userId: string): Promise<AppRole[]> {
  let lastError: unknown;
  for (const delay of SESSION_HYDRATION_DELAYS_MS) {
    await wait(delay);
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!error && data && data.length > 0) {
      return data.map((row) => row.role as AppRole);
    }
    if (error) lastError = error;
  }
  if (lastError) throw new Error("Could not verify account role. Please try again.");
  return [];
}

async function readCompanyAfterSignIn(userId: string): Promise<{
  slug: string;
  name: string | null;
  active: boolean;
} | null> {
  let lastError: unknown;
  for (const delay of SESSION_HYDRATION_DELAYS_MS) {
    await wait(delay);

    // Revalidate the newly issued session before tenant reads. On a fresh
    // browser the auth event and persisted session can hydrate a fraction of
    // a second after signInWithPassword resolves.
    const { data: verified, error: userError } = await supabase.auth.getUser();
    if (userError || verified.user?.id !== userId) {
      lastError = userError;
      continue;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      lastError = profileError;
      continue;
    }
    if (!profile?.company_id) continue;

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("name, status, url_slug")
      .eq("id", profile.company_id)
      .maybeSingle();
    if (companyError) {
      lastError = companyError;
      continue;
    }
    if (company?.url_slug) {
      return {
        slug: company.url_slug,
        name: company.name,
        active: company.status === "active",
      };
    }
  }
  if (lastError) throw new Error("Could not verify the account's company. Please try again.");
  return null;
}

/**
 * Sign in and immediately verify the account carries the required role.
 * If it doesn't, the session is torn down and an Error is thrown so the
 * caller can render the message on the same login screen. The auth state
 * never flips to "signed in" for a wrong-role account, so no redirect fires.
 */
export async function signInAsRole(
  email: string,
  password: string,
  requiredRole: AppRole | AppRole[],
): Promise<{ companySlug: string | null; isOwner: boolean }> {
  const allowed: AppRole[] = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("Sign in failed");

  let roles: AppRole[];
  try {
    roles = await readRolesAfterSignIn(userId);
  } catch (error) {
    await supabase.auth.signOut();
    throw error;
  }
  if (!allowed.some((r) => roles.includes(r))) {
    await supabase.auth.signOut();
    throw new Error(
      `This account is not registered as ${LABEL[allowed[0]]}. Please use the correct sign-in page.`,
    );
  }

  // The platform owner is above tenancy — a suspended company can never lock
  // the owner out of the platform console.
  if (roles.includes("platform_owner")) {
    return { companySlug: null, isOwner: true };
  }

  // A suspended company blocks every one of its accounts, whatever the role.
  // Resolve the tenant directly with the freshly authenticated browser
  // session. This avoids a server-function bearer race immediately after
  // sign-in and gives the caller a deterministic redirect destination.
  let company: Awaited<ReturnType<typeof readCompanyAfterSignIn>>;
  try {
    company = await readCompanyAfterSignIn(userId);
  } catch (error) {
    await supabase.auth.signOut();
    throw error;
  }

  if (company && !company.active) {
    await supabase.auth.signOut();
    throw new Error(
      `${company.name ?? "This provider"}'s account is suspended. Please contact RedArt Digital to restore access.`,
    );
  }

  // Fail closed: without an authoritative company we must NOT let the caller
  // fall back to whatever slug happened to be in the URL.
  if (!company) {
    await supabase.auth.signOut();
    throw new Error("Your account isn't linked to a provider. Contact your administrator.");
  }

  return { companySlug: company.slug, isOwner: false };
}


