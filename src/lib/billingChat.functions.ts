import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BillingColleague = {
  user_id: string;
  name: string;
  email: string | null;
  role: string;
};

/**
 * Lists the other billing staff (biller / admin biller / admin) inside the
 * caller's own company so billers can start a direct message thread.
 */
export const listBillingColleagues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingColleague[]> => {
    const { data: canBill } = await context.supabase.rpc("current_user_can_bill");
    if (!canBill) throw new Error("Billing staff only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();
    const companyId = me?.company_id;
    if (!companyId) throw new Error("No company linked to this account");

    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", companyId)
      .in("role", ["billing", "admin_biller", "admin"]);
    if (error) throw new Error(error.message);

    const byUser = new Map<string, string>();
    for (const r of roles ?? []) {
      if (r.user_id === context.userId) continue;
      const current = byUser.get(r.user_id);
      // Prefer the most descriptive role label.
      if (!current || r.role === "admin_biller") byUser.set(r.user_id, r.role as string);
    }
    if (!byUser.size) return [];

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("id", Array.from(byUser.keys()));

    return (profs ?? []).map((p) => ({
      user_id: p.id,
      name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Teammate",
      email: p.email,
      role: byUser.get(p.id) ?? "billing",
    }));
  });

/**
 * Returns (creating if needed) the direct conversation between the caller and
 * another billing teammate in the same company.
 */
export const ensureBillingConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { other_user_id: string }) => input)
  .handler(async ({ data, context }): Promise<{ conversation_id: string }> => {
    const { data: canBill } = await context.supabase.rpc("current_user_can_bill");
    if (!canBill) throw new Error("Billing staff only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id")
      .in("id", [context.userId, data.other_user_id]);
    const mine = rows?.find((r) => r.id === context.userId)?.company_id ?? null;
    const theirs = rows?.find((r) => r.id === data.other_user_id)?.company_id ?? null;
    if (!mine || mine !== theirs) throw new Error("Teammate is not in your company");

    const { data: existing } = await supabaseAdmin
      .from("staff_conversations")
      .select("id")
      .eq("company_id", mine)
      .or(
        `and(member_a.eq.${context.userId},member_b.eq.${data.other_user_id}),and(member_a.eq.${data.other_user_id},member_b.eq.${context.userId})`,
      )
      .maybeSingle();
    if (existing?.id) return { conversation_id: existing.id };

    const { data: created, error } = await supabaseAdmin
      .from("staff_conversations")
      .insert({ company_id: mine, member_a: context.userId, member_b: data.other_user_id })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { conversation_id: created.id };
  });
