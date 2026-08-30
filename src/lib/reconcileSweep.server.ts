/**
 * BULK READ-ONLY HCPF RECONCILIATION SWEEP — server side.
 *
 * Contract (enforced by this module, not by convention):
 *   - The ONLY outbound portal call is the read-only
 *     `POST /search-claim-by-trip` job on the claim-status checker.
 *   - Nothing is submitted, resubmitted, queued, edited, deleted, or moved to
 *     another stage. Bills stay exactly where they are until a biller confirms.
 *   - At most ONE active portal session per company, and the global ceiling is
 *     shared with the paid-amount status audit (both are clamped in
 *     `lease_reconcile_jobs`), so an account session is never invalidated.
 *   - Every search writes a billing_audit_log entry with no credentials and no
 *     portal HTML.
 */
import { logAudit } from "@/lib/billingHelpers";
import { envInt, maxGlobal } from "@/lib/claimStatusSync.server";
import { findLinkedBills, portalDateMDY } from "@/lib/hcpfSearch.server";
import { searchClaimByTrip } from "@/lib/tripClaimSearch.server";
import { stageOfFlatRow, flattenAttentionRow, ATTENTION_COUNT_LIMIT } from "@/lib/attentionCounts";
import {
  classifySearch,
  sanitizeSweepError,
  summarize,
  type SweepProgress,
  type SweepResultRow,
} from "@/lib/reconcileSweep";

export const SWEEP_LEASE_SECONDS = () => envInt("RECONCILE_LEASE_SECONDS", 300, 60, 1800);
export const SWEEP_STALE_GRACE_SECONDS = () => envInt("RECONCILE_STALE_GRACE_SECONDS", 120, 30, 1800);
/** Hard wall-clock ceiling for one tick, well inside the cron/request budget. */
export const SWEEP_RUN_BUDGET_MS = () => envInt("RECONCILE_RUN_BUDGET_MS", 100_000, 10_000, 240_000);

const CANDIDATE_SELECT = `id, status, requires_human_step, submission_error, submit_last_error,
  failure_code, state_confirmation_number, trip_id, company_id, archived_at,
  medicaid_trips!inner(id, pickup_at, company_id, robot_last_status,
    robot_confirmation_number, submitted_confirmation, riders(full_name, medicaid_id))`;

export type SweepCandidate = {
  billing_record_id: string;
  company_id: string;
  trip_id: string | null;
  member_id: string | null;
  service_date: string | null;
  passenger_name: string | null;
};

/**
 * Bills that need reconciling: currently in Needs Attention / Verification
 * Hold and carrying NO portal claim number anywhere.
 */
export async function findSweepCandidates(
  supabase: any,
  companyId: string,
): Promise<SweepCandidate[]> {
  const { data, error } = await supabase
    .from("billing_records")
    .select(CANDIDATE_SELECT)
    .eq("company_id", companyId)
    .in("status", ["approved", "needs_fix"])
    .limit(ATTENTION_COUNT_LIMIT);
  if (error) throw new Error(error.message);

  const out: SweepCandidate[] = [];
  for (const r of (data ?? []) as any[]) {
    const t = r.medicaid_trips ?? {};
    if (r.state_confirmation_number || t.robot_confirmation_number || t.submitted_confirmation)
      continue;
    const stage = stageOfFlatRow(flattenAttentionRow(r));
    if (stage !== "attention" && stage !== "hold") continue;
    out.push({
      billing_record_id: r.id,
      company_id: r.company_id ?? t.company_id ?? companyId,
      trip_id: r.trip_id ?? t.id ?? null,
      member_id: String(t?.riders?.medicaid_id ?? "").trim() || null,
      service_date: t?.pickup_at ? portalDateMDY(t.pickup_at) : null,
      passenger_name: t?.riders?.full_name ?? null,
    });
  }
  return out;
}

/** Start (or top up) the sweep for a company. Never touches the bills. */
export async function startSweep(
  supabase: any,
  args: { companyId: string; actorId: string | null },
): Promise<{ sweep_id: string; enqueued: number; total: number }> {
  const candidates = await findSweepCandidates(supabase, args.companyId);

  const { data: existing } = await supabase
    .from("claim_reconcile_sweeps")
    .select("id, status")
    .eq("company_id", args.companyId)
    .in("status", ["running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1);

  let sweepId = (existing ?? [])[0]?.id as string | undefined;
  if (!sweepId) {
    const { data, error } = await supabase
      .from("claim_reconcile_sweeps")
      .insert({
        company_id: args.companyId,
        status: "running",
        created_by: args.actorId,
        total: candidates.length,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    sweepId = data.id as string;
  } else {
    await supabase
      .from("claim_reconcile_sweeps")
      .update({ status: "running" })
      .eq("id", sweepId);
  }

  if (candidates.length) {
    const rows = candidates.map((c) => ({
      sweep_id: sweepId,
      company_id: c.company_id,
      billing_record_id: c.billing_record_id,
      trip_id: c.trip_id,
      member_id: c.member_id,
      service_date: c.service_date,
    }));
    // Idempotent: re-running never duplicates or resets an answered row.
    const { error } = await supabase
      .from("claim_reconcile_results")
      .upsert(rows, { onConflict: "sweep_id,billing_record_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const { count } = await supabase
    .from("claim_reconcile_results")
    .select("id", { count: "exact", head: true })
    .eq("sweep_id", sweepId);
  await supabase
    .from("claim_reconcile_sweeps")
    .update({ total: count ?? candidates.length })
    .eq("id", sweepId);

  return { sweep_id: sweepId!, enqueued: candidates.length, total: count ?? candidates.length };
}

export async function setSweepStatus(
  supabase: any,
  args: { sweepId: string; status: "running" | "paused" | "done" },
) {
  const patch: any = { status: args.status };
  if (args.status === "done") patch.finished_at = new Date().toISOString();
  const { error } = await supabase
    .from("claim_reconcile_sweeps")
    .update(patch)
    .eq("id", args.sweepId);
  if (error) throw new Error(error.message);
  return { ok: true as const, status: args.status };
}

export type LeasedSweepJob = {
  id: string;
  sweep_id: string;
  company_id: string;
  billing_record_id: string;
  trip_id: string | null;
  member_id: string | null;
  service_date: string | null;
  attempts: number;
};

export async function leaseSweepJobs(
  supabase: any,
  opts: { globalLimit: number; perCompanyLimit: number; leaseSeconds: number; worker: string },
): Promise<LeasedSweepJob[]> {
  const { data, error } = await supabase.rpc("lease_reconcile_jobs", {
    _global_limit: opts.globalLimit,
    _per_company_limit: opts.perCompanyLimit,
    _lease_seconds: opts.leaseSeconds,
    _worker: opts.worker,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeasedSweepJob[];
}

/** Search ONE leased bill read-only and store the candidates. Never mutates the bill. */
export async function processSweepJob(
  supabase: any,
  job: LeasedSweepJob,
): Promise<{ outcome: string }> {
  if (!job.member_id || !job.service_date) {
    await supabase
      .from("claim_reconcile_results")
      .update({
        outcome: "error",
        error: "This trip has no Medicaid member ID or service date, so HCPF cannot be searched.",
        locked_until: null,
        searched_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { outcome: "error" };
  }

  const out = await searchClaimByTrip({
    companyId: job.company_id,
    memberId: job.member_id,
    serviceDate: job.service_date,
    tripId: job.trip_id,
  });

  if (!out.ok) {
    const detail = sanitizeSweepError(out.detail);
    await supabase
      .from("claim_reconcile_results")
      .update({
        outcome: "error",
        error: detail,
        result_state: null,
        locked_until: null,
        searched_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await logAudit(
      supabase,
      job.billing_record_id,
      null,
      "hcpf_bulk_search_unavailable",
      `Read-only bulk HCPF lookup for member ${job.member_id} on ${job.service_date} could not run (${detail}). Nothing was submitted or changed.`,
      "system",
    );
    return { outcome: "error" };
  }

  // Annotate every candidate with the RedArt bill it already belongs to, so a
  // used claim id can never be re-attached.
  const linked = await findLinkedBills(
    supabase,
    job.company_id,
    out.claims.map((c) => c.claim_id),
  );
  for (const c of out.claims) c.linked = linked.get(c.claim_id) ?? null;

  const outcome = classifySearch(out);
  await supabase
    .from("claim_reconcile_results")
    .update({
      outcome,
      candidates: out.claims,
      match_count: out.match_count,
      result_state: out.result_state,
      error: null,
      locked_until: null,
      searched_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await logAudit(
    supabase,
    job.billing_record_id,
    null,
    "hcpf_bulk_search",
    `Read-only bulk HCPF lookup for member ${job.member_id} on ${job.service_date} returned ${out.claims.length} candidate(s)${
      out.claims.length ? `: ${out.claims.map((c) => c.claim_id).join(", ")}` : ""
    }. Result: ${outcome}. Nothing was submitted, queued or changed — a biller must confirm.`,
    "system",
  );
  return { outcome };
}

export type SweepTickResult = {
  ok: boolean;
  leased: number;
  processed: number;
  released: number;
  outcomes: Record<string, number>;
  reason?: string;
};

/** One scheduler tick. Bounded, single-flight, and safe to run concurrently. */
export async function runSweepTick(supabase: any): Promise<SweepTickResult> {
  const started = Date.now();
  const budget = started + SWEEP_RUN_BUDGET_MS();
  const outcomes: Record<string, number> = {};
  let released = 0;
  try {
    const { data } = await supabase.rpc("release_stale_reconcile_locks", {
      _grace_seconds: SWEEP_STALE_GRACE_SECONDS(),
    });
    released = Number(data ?? 0);
  } catch {
    // A failed sweep of stale locks never blocks the tick.
  }

  let jobs: LeasedSweepJob[] = [];
  try {
    jobs = await leaseSweepJobs(supabase, {
      // Shares the read-only checker ceiling with the paid-amount audit.
      globalLimit: maxGlobal(),
      perCompanyLimit: 1,
      leaseSeconds: SWEEP_LEASE_SECONDS(),
      worker: `sweep-${Math.random().toString(36).slice(2, 8)}`,
    });
  } catch (e: any) {
    return { ok: false, leased: 0, processed: 0, released, outcomes, reason: sanitizeSweepError(e) };
  }

  if (!jobs.length) {
    return { ok: true, leased: 0, processed: 0, released, outcomes, reason: "no eligible work" };
  }

  let processed = 0;
  await Promise.all(
    jobs.map(async (job) => {
      if (Date.now() > budget) return;
      try {
        const r = await processSweepJob(supabase, job);
        outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
        processed += 1;
      } catch (e: any) {
        outcomes["error"] = (outcomes["error"] ?? 0) + 1;
        await supabase
          .from("claim_reconcile_results")
          .update({ outcome: "error", error: sanitizeSweepError(e), locked_until: null })
          .eq("id", job.id);
      }
    }),
  );

  // A sweep with nothing left to search finishes itself.
  await finishIdleSweeps(supabase);

  return { ok: true, leased: jobs.length, processed, released, outcomes };
}

async function finishIdleSweeps(supabase: any) {
  const { data: running } = await supabase
    .from("claim_reconcile_sweeps")
    .select("id")
    .eq("status", "running");
  for (const s of (running ?? []) as any[]) {
    const { count } = await supabase
      .from("claim_reconcile_results")
      .select("id", { count: "exact", head: true })
      .eq("sweep_id", s.id)
      .in("outcome", ["pending", "searching", "error"]);
    if ((count ?? 0) === 0) {
      await supabase
        .from("claim_reconcile_sweeps")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", s.id);
    }
  }
}

/** Everything the progress card needs, in one read. */
export async function loadSweepProgress(
  supabase: any,
  companyId: string,
): Promise<{
  sweep: { id: string; status: string; created_at: string } | null;
  progress: SweepProgress;
  rows: SweepResultRow[];
}> {
  const { data: sweeps } = await supabase
    .from("claim_reconcile_sweeps")
    .select("id, status, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1);
  const sweep = (sweeps ?? [])[0] ?? null;
  if (!sweep) {
    return {
      sweep: null,
      progress: summarize([]),
      rows: [],
    };
  }
  const { data } = await supabase
    .from("claim_reconcile_results")
    .select(
      `id, billing_record_id, trip_id, member_id, service_date, outcome, candidates,
       match_count, result_state, error, attempts, searched_at, confirmed_at, confirm_kind`,
    )
    .eq("sweep_id", sweep.id)
    .limit(1000);
  const rows = ((data ?? []) as any[]).map((r) => ({
    ...r,
    candidates: Array.isArray(r.candidates) ? r.candidates : [],
  })) as SweepResultRow[];
  return { sweep, progress: summarize(rows), rows };
}

/** Mark a sweep row as resolved by a biller. The claim link itself is written
 *  by the existing verification writers — this only records the decision. */
export async function markSweepRowConfirmed(
  supabase: any,
  args: { recordId: string; actorId: string; kind: "linked" | "no_claim" },
) {
  await supabase
    .from("claim_reconcile_results")
    .update({
      confirmed_at: new Date().toISOString(),
      confirmed_by: args.actorId,
      confirm_kind: args.kind,
      locked_until: null,
    })
    .eq("billing_record_id", args.recordId)
    .is("confirmed_at", null);
}
