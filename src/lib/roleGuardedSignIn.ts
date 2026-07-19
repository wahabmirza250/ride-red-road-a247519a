import { supabase } from "@/lib/supabaseBrowser";
import type { AppRole } from "@/lib/auth";

const LABEL: Record<AppRole, string> = {
  admin: "an admin/dispatch",
  driver: "a driver",
  passenger: "a passenger",
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
}
