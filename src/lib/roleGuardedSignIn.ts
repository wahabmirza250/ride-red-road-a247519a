import { supabase } from "@/lib/supabaseBrowser";
import type { AppRole } from "@/lib/auth";

const LABEL: Record<AppRole, string> = {
  admin: "an admin/owner",
  driver: "a driver",
  passenger: "a passenger",
  dispatch: "a dispatcher",
  billing: "a billing specialist",
  platform_owner: "a platform owner",
};

/**
 * Sign in and immediately verify the account carries the required role.
 * If it doesn't, the session is torn down and an Error is thrown so the
 * caller can render the message on the same login screen. The auth state
 * never flips to "signed in" for a wrong-role account, so no redirect fires.
 */
export async function signInAsRole(
  email: string,
  password: string,
  requiredRole: AppRole,
): Promise<{ companySlug: string | null; isOwner: boolean }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("Sign in failed");

  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (roleErr) {
    await supabase.auth.signOut();
    throw new Error("Could not verify account role. Please try again.");
  }

  const roles = (roleRows ?? []).map((r) => r.role as AppRole);
  if (!roles.includes(requiredRole)) {
    await supabase.auth.signOut();
    throw new Error(
      `This account is not registered as ${LABEL[requiredRole]}. Please use the correct sign-in page.`,
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
  let status: { name: string | null; active: boolean } | null = null;
  let companySlug: string | null = null;
  const { data: prof, error: profileError } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    await supabase.auth.signOut();
    throw new Error("Could not verify the account's company. Please try again.");
  }
  if (prof?.company_id) {
    const { data: co, error: companyError } = await supabase
      .from("companies")
      .select("name, status, url_slug")
      .eq("id", prof.company_id)
      .maybeSingle();
    if (companyError || !co) {
      await supabase.auth.signOut();
      throw new Error("Could not verify the account's company. Please try again.");
    }
    status = { name: co.name, active: co.status === "active" };
    companySlug = co.url_slug;
  }

  if (status && !status.active) {
    await supabase.auth.signOut();
    throw new Error(
      `${status.name ?? "This provider"}'s account is suspended. Please contact RedArt Digital to restore access.`,
    );
  }

  // Fail closed: without an authoritative company we must NOT let the caller
  // fall back to whatever slug happened to be in the URL.
  if (!companySlug) {
    await supabase.auth.signOut();
    throw new Error("Your account isn't linked to a provider. Contact your administrator.");
  }

  return { companySlug, isOwner: false };
}


