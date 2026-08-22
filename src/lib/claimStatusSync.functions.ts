import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClaimStatusSyncState = {
  paused: boolean;
  pause_reason: string | null;
  last_run_at: string | null;
  last_result: {
    checked?: number;
    changed?: number;
    unchanged?: number;
    skipped?: number;
    companies?: number;
    reason?: string | null;
  };
  due_now: number;
};

async function assertBillingOrAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: canBill }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("current_user_can_bill"),
  ]);
  if (!isAdmin && !canBill) throw new Error("Forbidden: billing or admin only");
}

/** Current state of the scheduled read-only status checker. */
export const getClaimStatusSyncState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClaimStatusSyncState> => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { OPEN_STATUSES } = await import("@/lib/claimStatusSync.server");

    const [{ data: state }, { count }] = await Promise.all([
      supabase
        .from("claim_status_sync_state")
        .select("paused, pause_reason, last_run_at, last_result")
        .eq("id", true)
        .maybeSingle(),
      supabase
        .from("billing_records")
        .select("id", { count: "exact", head: true })
        .in("status", OPEN_STATUSES)
        .not("state_confirmation_number", "is", null),
    ]);

    return {
      paused: Boolean(state?.paused),
      pause_reason: state?.pause_reason ?? null,
      last_run_at: state?.last_run_at ?? null,
      last_result: (state?.last_result ?? {}) as ClaimStatusSyncState["last_result"],
      due_now: count ?? 0,
    };
  });

/**
 * Manual kick of the same read-only sync the schedule runs.
 * Optionally limited to specific billing records.
 */
export const runClaimStatusSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ recordIds: z.array(z.string().uuid()).max(50).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runClaimStatusSync, MANUAL_RUN_BUDGET_MS } = await import("@/lib/claimStatusSync.server");
    // Manual kicks are strictly time-boxed so the UI never sits spinning:
    // whatever is not finished stays queued for the background schedule.
    return await runClaimStatusSync(supabaseAdmin, {
      actorId: userId,
      recordIds: data.recordIds,
      force: Boolean(data.recordIds?.length),
      budgetMs: MANUAL_RUN_BUDGET_MS,
    });
  });
