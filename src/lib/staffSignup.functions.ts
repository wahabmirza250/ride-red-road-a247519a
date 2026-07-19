import { createServerFn } from "@tanstack/react-start";

type StaffSignupInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: "admin" | "dispatch";
  invite_code: string;
};

export const staffSignupWithCode = createServerFn({ method: "POST" })
  .inputValidator((input: StaffSignupInput) => input)
  .handler(async ({ data }) => {
    const expected = process.env.ADMIN_SIGNUP_CODE;
    if (!expected) throw new Error("Signup is disabled: no invite code configured");
    if (!data.invite_code || data.invite_code.trim() !== expected) {
      throw new Error("Invalid invite code");
    }
    if (!data.email || !data.password || data.password.length < 8) {
      throw new Error("Email and a password of at least 8 characters are required");
    }
    if (data.role !== "admin" && data.role !== "dispatch") {
      throw new Error("Invalid role");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        phone: data.phone.trim(),
        role: data.role,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create account");

    const userId = created.user.id;

    // handle_new_user trigger defaults to 'passenger' — override with requested role.
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).neq("role", data.role);

    await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        phone: data.phone.trim(),
      })
      .eq("id", userId);

    return { ok: true };
  });
