import { createFileRoute } from "@tanstack/react-router";

const TARGET_EMAIL = "wahabmirza250@gmail.com";

export const Route = createFileRoute("/api/public/reset-admin-once")({
  server: {
    handlers: {
      POST: async () => {
        const newPassword = process.env.ADMIN_RESET_NEW_PASSWORD;
        if (!newPassword || newPassword.length < 6) {
          return new Response("ADMIN_RESET_NEW_PASSWORD missing/short", { status: 500 });
        }
        console.log("[reset-admin-once] pw length=", newPassword.length);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let userId: string | null = null;
        for (let page = 1; page <= 20 && !userId; page++) {
          const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) return new Response(error.message, { status: 500 });
          const m = data.users.find((u) => (u.email ?? "").toLowerCase() === TARGET_EMAIL);
          if (m) userId = m.id;
          if (data.users.length < 200) break;
        }
        if (!userId) return new Response(`No user for ${TARGET_EMAIL}`, { status: 404 });

        const { data: roles, error: roleErr } = await supabaseAdmin
          .from("user_roles").select("role").eq("user_id", userId);
        if (roleErr) return new Response(roleErr.message, { status: 500 });
        if (!roles?.some((r) => r.role === "admin")) {
          return new Response("Not an admin; refusing", { status: 403 });
        }

        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: newPassword,
          email_confirm: true,
        });
        if (updErr) return new Response(updErr.message, { status: 500 });

        return new Response(JSON.stringify({ ok: true, email: TARGET_EMAIL }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
