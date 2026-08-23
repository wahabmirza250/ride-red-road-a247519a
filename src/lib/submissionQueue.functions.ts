import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SubmissionQueueMetricRow = {
  company_id: string | null;
  company_name: string | null;
  queued: number;
  retrying: number;
  processing: number;
  leased: number;
  needs_attention: number;
  submitted_last_hour: number;
  stale_locks: number;
  oldest_queued_at: string | null;
  avg_submit_ms: number | null;
  last_submitted_at: string | null;
};

export type SubmissionQueueState = {
  paused: boolean;
  pause_reason: string | null;
  last_run_at: string | null;
  last_result: Record<string, string | number | boolean | null>;
  limits: {
    per_company: number;
    global: number;
    lease_seconds: number;
    max_attempts: number;
    run_budget_ms: number;
  };
  metrics: SubmissionQueueMetricRow[];
  health: { ok: boolean; issues: string[] };
};

async function assertBillingOrAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: canBill }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("current_user_can_bill"),
  ]);
  if (!isAdmin && !canBill) throw new Error("Forbidden: billing or admin only");
}

/** Operations surface for the submission queue: limits, metrics and health. */
export const getSubmissionQueueState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubmissionQueueState> => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const mod = await import("@/lib/submissionQueue.server");

    const [{ data: state }, { data: metrics }] = await Promise.all([
      supabase
        .from("submission_queue_state")
        .select("paused, pause_reason, last_run_at, last_result")
        .eq("id", true)
        .maybeSingle(),
      // RLS-scoped view: a company only ever sees its own rows.
      supabase.from("submission_queue_metrics").select("*"),
    ]);

    const rows = (metrics ?? []) as SubmissionQueueMetricRow[];
    const issues: string[] = [];
    const staleLocks = rows.reduce((n, r) => n + Number(r.stale_locks ?? 0), 0);
    if (staleLocks > 0) issues.push(`${staleLocks} abandoned worker lease(s) awaiting release`);
    const lastRun = state?.last_run_at ? new Date(state.last_run_at).getTime() : 0;
    const backlog = rows.reduce((n, r) => n + Number(r.queued ?? 0), 0);
    if (backlog > 0 && lastRun && Date.now() - lastRun > 10 * 60_000) {
      issues.push("Scheduler has not run in the last 10 minutes while work is waiting");
    }

    return {
      paused: Boolean(state?.paused),
      pause_reason: state?.pause_reason ?? null,
      last_run_at: state?.last_run_at ?? null,
      last_result: (state?.last_result ?? {}) as Record<string, string | number | boolean | null>,
      limits: {
        per_company: mod.maxSubmitPerCompany(),
        global: mod.maxSubmitGlobal(),
        lease_seconds: mod.submitLeaseSeconds(),
        max_attempts: mod.maxSubmitAttempts(),
        run_budget_ms: mod.SUBMIT_RUN_BUDGET_MS(),
      },
      metrics: rows,
      health: { ok: issues.length === 0 && !state?.paused, issues },
    };
  });

/** Global stop/resume switch for automatic portal submissions. */
export const setSubmissionQueuePaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ paused: z.boolean(), reason: z.string().trim().max(300).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { error } = await supabase
      .from("submission_queue_state")
      .update({
        paused: data.paused,
        pause_reason: data.paused
          ? (data.reason ?? "Paused manually by billing staff")
          : null,
        paused_by: data.paused ? userId : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true, paused: data.paused };
  });

/** Manual, fast "run the queue now" kick — enqueue/lease only, never blocking. */
export const runSubmissionQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { data: companyId } = await supabase.rpc("current_user_company_id");
    const { runSubmissionQueueTick } = await import("@/lib/submissionQueue.server");
    return await runSubmissionQueueTick(supabase, {
      actorId: userId,
      companyId: companyId ?? null,
      worker: `manual-${userId.slice(0, 8)}`,
    });
  });
