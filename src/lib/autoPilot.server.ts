/**
 * AUTO PILOT ENGINE (server-only). See `autoPilot.ts` for the rules.
 *
 * State lives in `auto_pilot_runs`, so a refresh, a new tab, a redeploy or a
 * worker restart changes nothing: the queue tick keeps feeding the run.
 */
import { AUTO_PILOT_WAVE, isRunComplete, nextFeedSize, type AutoPilotState } from "@/lib/autoPilot";
import { submitSelectedRecords } from "@/lib/submitSelection.server";

type Sb = any;

/** Bills a biller could legitimately press Submit on right now. */
export async function listEligibleBillIds(
  supabase: Sb,
  opts: { companyId?: string | null; scopeIds?: string[] | null; limit?: number } = {},
): Promise<string[]> {
  let q = supabase
    .from("billing_records")
    .select("id")
    .in("status", ["approved", "needs_fix"])
    .not("requires_human_step", "is", true)
    .is("state_confirmation_number", null)
    .is("attention_archived_at", null)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(500, opts.limit ?? 500)));
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.scopeIds?.length) q = q.in("id", opts.scopeIds);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((r: any) => r.id as string);
}

/** Queued + sending in this company lane right now. */
export async function countInFlight(supabase: Sb, companyId: string | null): Promise<number> {
  let q = supabase
    .from("billing_records")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "submitting"]);
  if (companyId) q = q.eq("company_id", companyId);
  const { count, error } = await q;
  if (error) return 0;
  return Number(count ?? 0);
}

async function activeRun(supabase: Sb, companyId: string | null) {
  let q = supabase
    .from("auto_pilot_runs")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1);
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q;
  return (data ?? [])[0] ?? null;
}

export async function getAutoPilotState(
  supabase: Sb,
  companyId: string | null,
): Promise<AutoPilotState> {
  const run = await activeRun(supabase, companyId);
  const scopeIds = (run?.scope_ids as string[] | null) ?? null;
  const [eligible, inFlight] = await Promise.all([
    listEligibleBillIds(supabase, { companyId, scopeIds }),
    countInFlight(supabase, companyId),
  ]);
  return {
    running: Boolean(run),
    runId: run?.id ?? null,
    status: run?.status ?? null,
    enqueued: Number(run?.total_enqueued ?? 0),
    remaining: eligible.length,
    inFlight,
    startedAt: run?.created_at ?? null,
    lastFeedAt: run?.last_feed_at ?? null,
    label: "",
  };
}

/** Start (or re-use) a run. `scopeIds` limits it to the biller's selection. */
export async function startAutoPilot(
  supabase: Sb,
  args: { companyId: string | null; userId: string; scopeIds?: string[] | null },
): Promise<{ runId: string | null; requested: number; fed: number }> {
  const existing = await activeRun(supabase, args.companyId);
  const scopeIds = args.scopeIds?.length ? args.scopeIds : null;
  const eligible = await listEligibleBillIds(supabase, {
    companyId: args.companyId,
    scopeIds,
  });

  let runId: string | null = existing?.id ?? null;
  if (!runId) {
    const { data, error } = await supabase
      .from("auto_pilot_runs")
      .insert({
        company_id: args.companyId,
        started_by: args.userId,
        status: "running",
        total_requested: eligible.length,
        scope_ids: scopeIds,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    runId = (data?.id as string) ?? null;
  }

  const fed = await feedAutoPilot(supabase, {
    companyId: args.companyId,
    userId: args.userId,
  });
  return { runId, requested: eligible.length, fed: fed.enqueued };
}

/** Stop feeding. Nothing already sent to the portal is touched. */
export async function stopAutoPilot(
  supabase: Sb,
  companyId: string | null,
): Promise<{ stopped: boolean }> {
  const run = await activeRun(supabase, companyId);
  if (!run) return { stopped: false };
  await supabase
    .from("auto_pilot_runs")
    .update({ status: "stopped", stopped_at: new Date().toISOString() })
    .eq("id", run.id);
  return { stopped: true };
}

/**
 * ONE WAVE. Called by the biller's start click and then by every queue tick, so
 * the run continues in the background with nobody watching.
 */
export async function feedAutoPilot(
  supabase: Sb,
  args: { companyId: string | null; userId: string | null },
): Promise<{ enqueued: number; remaining: number; finished: boolean }> {
  const run = await activeRun(supabase, args.companyId);
  if (!run) return { enqueued: 0, remaining: 0, finished: false };

  const scopeIds = (run.scope_ids as string[] | null) ?? null;
  const [eligible, inFlight] = await Promise.all([
    listEligibleBillIds(supabase, { companyId: args.companyId, scopeIds }),
    countInFlight(supabase, args.companyId),
  ]);

  if (isRunComplete(eligible.length, inFlight)) {
    await supabase
      .from("auto_pilot_runs")
      .update({
        status: "finished",
        stopped_at: new Date().toISOString(),
        last_feed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    return { enqueued: 0, remaining: 0, finished: true };
  }

  const take = nextFeedSize(eligible.length, inFlight, AUTO_PILOT_WAVE);
  if (take <= 0) return { enqueued: 0, remaining: eligible.length, finished: false };

  const actor = args.userId ?? run.started_by ?? null;
  if (!actor) return { enqueued: 0, remaining: eligible.length, finished: false };

  // SAME PATH AS THE SUBMIT BUTTON — never a shortcut around preflight,
  // idempotency or the uncertain-outcome guards.
  const res = await submitSelectedRecords(supabase, actor, {
    ids: eligible.slice(0, take),
    label: `Auto Pilot wave (${take})`,
  });

  await supabase
    .from("auto_pilot_runs")
    .update({
      total_enqueued: Number(run.total_enqueued ?? 0) + res.queued,
      last_feed_at: new Date().toISOString(),
      last_note: res.skipped.length ? `${res.skipped.length} not sent in this wave` : null,
    })
    .eq("id", run.id);

  return {
    enqueued: res.queued,
    remaining: Math.max(0, eligible.length - res.queued),
    finished: false,
  };
}
