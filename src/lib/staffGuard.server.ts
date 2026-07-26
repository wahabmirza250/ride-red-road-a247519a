import type { SupabaseClient } from "@supabase/supabase-js";

export type StaffRole = "admin" | "dispatch";

/**
 * Verifies the caller carries a staff role. Returns the roles found so callers
 * can further restrict owner-only surfaces (billing, payroll, credentials).
 * Dispatchers get operational access only — never owner-only functions.
 */
export async function requireStaff(
  userId: string,
  allowed: StaffRole[] = ["admin", "dispatch"],
): Promise<{ roles: StaffRole[]; isAdmin: boolean; isDispatch: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const all = (data ?? []).map((r) => String(r.role));
  const roles = all.filter((r): r is StaffRole => r === "admin" || r === "dispatch");
  const isAdmin = roles.includes("admin");
  const isDispatch = roles.includes("dispatch");

  const ok = roles.some((r) => allowed.includes(r));
  if (!ok) {
    throw new Error(
      allowed.length === 1 && allowed[0] === "admin"
        ? "Admin only"
        : "Dispatch or admin access required",
    );
  }
  return { roles, isAdmin, isDispatch };
}

/** Best-effort display name for audit-log entries. */
export async function actorLabel(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return "Staff";
  return `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || data.email || "Staff";
}

type LogInput = {
  kind: string;
  actor_id: string;
  actor_name?: string;
  actor_role?: string;
  summary: string;
  request_id?: string | null;
  trip_id?: string | null;
  route_id?: string | null;
  driver_id?: string | null;
  data?: Record<string, unknown>;
};

/** Append to the dispatch audit trail. Never throws into the caller's path. */
export async function logDispatchEvent(input: LogInput) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("dispatch_events").insert({
      kind: input.kind,
      actor_id: input.actor_id,
      actor_name: input.actor_name ?? (await actorLabel(input.actor_id)),
      actor_role: input.actor_role ?? null,
      summary: input.summary,
      request_id: input.request_id ?? null,
      trip_id: input.trip_id ?? null,
      route_id: input.route_id ?? null,
      driver_id: input.driver_id ?? null,
      data: (input.data ?? {}) as never,
    });
  } catch (e) {
    console.warn("[dispatch-audit] failed", e);
  }
}
