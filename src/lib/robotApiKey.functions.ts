import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RobotApiKey {
  id: string;
  api_key: string;
  created_at: string;
  is_active: boolean;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin only");
}

function generateApiKey(): string {
  // 32 random bytes → 64 hex chars, prefixed for readability.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `rbt_${hex}`;
}

export const getRobotApiKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("robot_api_keys" as any)
      .select("id, api_key, created_at, is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as RobotApiKey | null;
  });

export const rotateRobotApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Deactivate all existing keys
    const { error: deactivateError } = await supabaseAdmin
      .from("robot_api_keys" as any)
      .update({ is_active: false })
      .eq("is_active", true);
    if (deactivateError) throw new Error(deactivateError.message);

    const newKey = generateApiKey();
    const { data, error } = await supabaseAdmin
      .from("robot_api_keys" as any)
      .insert({
        api_key: newKey,
        created_by: context.userId,
        is_active: true,
      })
      .select("id, api_key, created_at, is_active")
      .single();
    if (error) throw new Error(error.message);
    return data as RobotApiKey;
  });
