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
  /** Most recent claim that actually got a portal answer. */
  last_success_at: string | null;
  /** Claims currently waiting on a re-check after a checker timeout/outage. */
  retrying_now: number;
  /** Submission queue (separate system) — shown so the two are never confused. */
  submissions_paused: boolean;
  submissions_pause_reason: string | null;
  metrics: QueueMetricRow[];
};

export type QueueMetricRow = {
  company_id: string | null;
  company_name?: string | null;
  due_now: number;
  leased_running: number;
  retrying: number;
  errored: number;
  terminal: number;
  scheduled_total: number;
  checked_last_hour: number;
  stale_locks: number;
  avg_check_ms: number | null;
  oldest_due_at: string | null;
  last_checked_at: string | null;
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

    const [{ data: state }, { count }, { data: metrics }, { data: lastOk }, { count: retrying }, { data: queueState }] =
      await Promise.all([
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
      // RLS-scoped view: a biller only ever sees their own company's rows.
      supabase.from("claim_status_queue_metrics").select("*"),
      supabase
        .from("billing_records")
        .select("status_checked_at")
        .not("status_checked_at", "is", null)
        .order("status_checked_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("billing_records")
        .select("id", { count: "exact", head: true })
        .not("status_check_error", "is", null),
      supabase.from("submission_queue_state").select("paused, pause_reason").limit(1).maybeSingle(),
    ]);

    return {
      paused: Boolean(state?.paused),
      pause_reason: state?.pause_reason ?? null,
      last_run_at: state?.last_run_at ?? null,
      last_result: (state?.last_result ?? {}) as ClaimStatusSyncState["last_result"],
      due_now: count ?? 0,
      last_success_at: (lastOk as any)?.status_checked_at ?? null,
      retrying_now: retrying ?? 0,
      submissions_paused: Boolean((queueState as any)?.paused),
      submissions_pause_reason: (queueState as any)?.pause_reason ?? null,
      metrics: (metrics ?? []) as QueueMetricRow[],
    };
  });

/**
 * Manual "Check now" — ENQUEUE ONLY.
 *
 * It never talks to the portal itself: it just marks the claims due now and
 * returns immediately. The one-minute scheduler picks them up under the same
 * atomic per-claim lease, so a manual kick can never duplicate work that is
 * already running and the UI never spins waiting on portal traffic.
 */
export const runClaimStatusSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ recordIds: z.array(z.string().uuid()).max(50).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { data: companyId } = await supabase.rpc("current_user_company_id");
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enqueueClaimStatusChecks } = await import("@/lib/claimStatusSync.server");
    // Company scoping is preserved: a biller can only enqueue their own company.
    return await enqueueClaimStatusChecks(supabaseAdmin, {
      recordIds: data.recordIds,
      companyId: isAdmin || companyId ? (companyId ?? null) : null,
    });
  });

/** Admin/billing-only health probe: lock leaks + scheduler liveness. */
export const getClaimStatusHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { claimStatusHealth } = await import("@/lib/claimStatusSync.server");
    return await claimStatusHealth(supabaseAdmin);
  });
