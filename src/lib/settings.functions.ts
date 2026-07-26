import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Public read of the company auto-assign toggle. */
export const getAutoAssign = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "auto_assign_enabled")
    .maybeSingle();
  return { enabled: String(data?.value ?? "false").toLowerCase() === "true" };
});

/** Admin-only write of the auto-assign toggle. Dispatchers see it read-only. */
export const setAutoAssign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled: boolean }) => {
    if (typeof input?.enabled !== "boolean") throw new Error("enabled required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId, ["admin"]);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        {
          key: "auto_assign_enabled",
          value: data.enabled ? "true" : "false",
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);

    await logDispatchEvent({
      kind: "setting",
      actor_id: context.userId,
      actor_role: "admin",
      summary: `Auto-assign turned ${data.enabled ? "ON" : "OFF"}`,
    });

    return { enabled: data.enabled };
  });
