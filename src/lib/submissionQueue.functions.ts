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

/** One robot worker as shown to ops. No URL is ever sent to the browser. */
export type FleetWorkerSummary = {
  id: string;
  enabled: boolean;
  healthy: boolean;
  max_active_jobs: number;
  active_jobs: number;
  failure_streak: number;
  last_health_ok_at: string | null;
  last_health_error: string | null;
  unhealthy_until: string | null;
};

export type SubmissionFleetSummary = {
  total: number;
  healthy: number;
  degraded: number;
  disabled: boolean;
  capacity: number;
  active_jobs: number;
  effective_global_limit: number;
  workers: FleetWorkerSummary[];
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
  fleet?: SubmissionFleetSummary;
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

    // Fleet ops summary. URLs stay server-side — only worker ids are exposed.
    const fleetMod = await import("@/lib/robotFleet.server");
    const workers = await fleetMod.loadFleet(supabase);
    const load = await fleetMod.loadWorkerActiveCounts(supabase);
    const now = Date.now();
    const healthy = fleetMod.healthyWorkers(workers, now);
    const disabled = fleetMod.isFleetDisabled();
    const fleet = {
      total: workers.length,
      healthy: healthy.length,
      degraded: workers.length - healthy.length,
      disabled,
      capacity: fleetMod.fleetCapacity(workers, now),
      active_jobs: [...load.values()].reduce((a, b) => a + b, 0),
      effective_global_limit: fleetMod.effectiveGlobalLimit(workers, mod.maxSubmitGlobal(), now),
      workers: workers.map((w) => ({
        id: w.id,
        enabled: w.enabled,
        healthy: !disabled && fleetMod.isWorkerHealthy(w, now),
        max_active_jobs: w.max_active_jobs,
        active_jobs: load.get(w.id) ?? 0,
        failure_streak: w.failure_streak,
        last_health_ok_at: w.last_health_ok_at,
        last_health_error: w.last_health_error,
        unhealthy_until: w.unhealthy_until,
      })),
    };
    if (disabled) issues.push("Robot fleet kill switch is ON — no new submissions are dispatched");
    else if (fleet.total > 0 && fleet.healthy === 0)
      issues.push("No healthy submission robot is available");
    else if (fleet.degraded > 0) issues.push(`${fleet.degraded} robot worker(s) degraded`);

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
      fleet,
      metrics: rows,
      health: { ok: issues.length === 0 && !state?.paused, issues },
    };
  });

/**
 * Enable/disable ONE robot worker (admin only). Disabling drains it: accepted
 * jobs stay pinned to it for polling, but no new job is routed there.
 * Claim-status checking is a separate subsystem and is not affected.
 */
export const setRobotWorkerEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workerId: z.string().trim().min(1).max(100),
        enabled: z.boolean(),
        notes: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fleetMod = await import("@/lib/robotFleet.server");
    const known = (await fleetMod.loadFleet(supabaseAdmin)).find((w) => w.id === data.workerId);
    if (!known) throw new Error("Unknown robot worker");

    const { error } = await supabaseAdmin.from("robot_workers").upsert(
      {
        id: known.id,
        base_url: known.url,
        enabled: data.enabled,
        notes: data.notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, workerId: known.id, enabled: data.enabled };
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

/**
 * LIVE BATCH PROGRESS for the biller who clicked Submit. Read-only, RLS-scoped
 * and free of any worker/portal internals.
 */
export const getSubmissionBatchProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batch_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { getBatchProgress } = await import("@/lib/submissionBatch.server");
    return getBatchProgress(supabase, data.batch_id);
  });

/**
 * DONE / COMPLETED feed plus live queue counters. Read-only and RLS-scoped;
 * it powers the completed history section and the throughput telemetry.
 */
export const getSubmissionDoneFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(20).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { getDoneFeed } = await import("@/lib/submissionDone.server");
    return getDoneFeed(supabase, { limit: data?.limit });
  });


/**
 * Release any bill a previous build left parked behind a wave gate. Kept as a
 * one-click repair for ops; it only clears the hold on legitimate `queued`
 * rows and never touches anything that is submitting or awaiting verification.
 */
export const releaseHeldSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { releaseStrandedHolds } = await import("@/lib/submissionWaves.server");
    return await releaseStrandedHolds(supabase);
  });

