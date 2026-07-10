import { createServerFn } from "@tanstack/react-start";

const TARGET_EMAIL = "wahabmirza250@gmail.com";

export const resetAdminPasswordOnce = createServerFn({ method: "POST" }).handler(
  async () => {
    const newPassword = process.env.ADMIN_RESET_NEW_PASSWORD;
    if (!newPassword || newPassword.length < 6) {
      throw new Error("ADMIN_RESET_NEW_PASSWORD is missing or too short");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find the target user by email (paginate defensively)
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw error;
      const match = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === TARGET_EMAIL,
      );
      if (match) userId = match.id;
      if (data.users.length < 200) break;
    }
    if (!userId) throw new Error(`No user found for ${TARGET_EMAIL}`);

    // Safety guard: must have admin role
    const { data: roles, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw roleErr;
    if (!roles?.some((r) => r.role === "admin")) {
      throw new Error("Target user is not an admin; refusing to reset");
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword, email_confirm: true },
    );
    if (updErr) throw updErr;

    return { ok: true, email: TARGET_EMAIL };
  },
);
