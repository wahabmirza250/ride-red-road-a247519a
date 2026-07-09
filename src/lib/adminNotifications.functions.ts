import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAdminNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("admin_notifications")
      .select("id, kind, title, body, data, url, read, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; all?: boolean }) => input)
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("admin_notifications").update({ read: true });
    if (data.all) q = q.eq("read", false);
    else if (data.id) q = q.eq("id", data.id);
    else throw new Error("id or all required");
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
