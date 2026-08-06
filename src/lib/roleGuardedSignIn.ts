import { supabase } from "@/lib/supabaseBrowser";
import { getMyCompany } from "@/lib/companyPublic.functions";
import type { AppRole } from "@/lib/auth";

const LABEL: Record<AppRole, string> = {
  admin: "an admin/owner",
  driver: "a driver",
  passenger: "a passenger",
  dispatch: "a dispatcher",
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
): Promise<void> {
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
  if (roles.includes("platform_owner")) return;

  // A suspended company blocks every one of its accounts, whatever the role.
  // Resolved server-side from the bearer token so it can't be skipped by RLS
  // visibility quirks or a tampered client. The bearer attachment can lag a
  // freshly minted session by a tick, so retry before falling back to a
  // direct (RLS-scoped) read — never let a race silently allow a login.
  let status: { name: string | null; active: boolean } | null = null;

  for (let attempt = 0; attempt < 3 && !status; attempt++) {
    try {
      const mine = await getMyCompany({});
      if (mine.slug) status = { name: mine.name, active: mine.active };
      else return; // no company linked; the tenant gate handles it
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (!status) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.company_id) {
      const { data: co } = await supabase
        .from("companies")
        .select("name, status")
        .eq("id", prof.company_id)
        .maybeSingle();
      if (co) status = { name: co.name, active: co.status === "active" };
    }
  }

  if (status && !status.active) {
    await supabase.auth.signOut();
    throw new Error(
      `${status.name ?? "This provider"}'s account is suspended. Please contact RedArt Digital to restore access.`,
    );
  }
}


