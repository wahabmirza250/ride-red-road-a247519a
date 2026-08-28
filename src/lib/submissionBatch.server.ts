/**
 * BATCH ENQUEUE (server-only) — one click, everything queued.
 *
 * A biller may select 1 or 200+ bills and click Submit once. This module turns
 * that click into durable queue state as fast as possible and then returns —
 * no portal work happens on the request thread, and NOTHING is held back:
 * every accepted bill becomes plain `queued` and the leasing RPC decides how
 * many actually run at once. There is no wave gate that can strand work.
 *
 * Invariants (unchanged):
 *   - Every enqueued bill is stamped with the HCPF ACCOUNT KEY it must
 *     serialize on, so all billers of one company share one capacity-limited
 *     lane while other companies run in parallel.
 *   - Every enqueued bill is stamped with an immutable IDEMPOTENCY KEY
 *     (`account|trip_id|service_date|vN`). The unique index on that column
 *     collapses double clicks, refreshes, extra tabs and two billers picking
 *     the same bill into ONE job. Distinct trips of the same passenger on the
 *     same day have different trip ids, so they never collide.
 *   - A bill that is already `queued`/`submitting` is reported as a duplicate.
 *   - One bad bill can never abort the batch: failures are per-record AND they
 *     are reported with a reason instead of being hidden as "duplicate".
 */
import { buildIdempotencyKey, versionOfKey } from "@/lib/submissionIdempotency";
import { resolveAccountKey } from "@/lib/submissionAccount.server";
import { logAudit } from "@/lib/billingHelpers";
import { DEFAULT_WAVE_SIZE, clampWaveSize } from "@/lib/submissionWaves";
import { countWave } from "@/lib/submissionWaves.server";
import { classifyEnqueueOutcome, isActiveQueueStatus } from "@/lib/submissionEnqueueOutcome";

export type BatchCandidate = {
  id: string;
  companyId: string | null;
  tripId: string;
  serviceDate: string | null;
  /** Acknowledged resubmission: gets a fresh idempotency version. */
  resubmit?: boolean;
};

export type BatchEnqueueResult = {
  batchId: string | null;
  enqueued: string[];
  duplicates: string[];
  failed: Array<{ id: string; reason: string }>;
};

/** Enqueue in modest chunks: hundreds of simultaneous round trips are what
 * made a large batch fail as a block. */
const CHUNK = 10;

async function createBatch(
  supabase: any,
  args: {
    companyId: string | null;
    actorId: string | null;
    label: string | null;
    total: number;
  },
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("submission_batches")
      .insert({
        company_id: args.companyId,
        created_by: args.actorId,
        label: args.label,
        total_requested: args.total,
      })
      .select("id")
      .maybeSingle();
    return (data?.id as string) ?? null;
  } catch {
    // Batch rows are progress reporting only — never block a submission on them.
    return null;
  }
}

export async function enqueueSubmissionBatch(
  supabase: any,
  args: {
    actorId: string | null;
    candidates: BatchCandidate[];
    label?: string | null;
  },
): Promise<BatchEnqueueResult> {
  const { candidates, actorId } = args;
  const result: BatchEnqueueResult = {
    batchId: null,
    enqueued: [],
    duplicates: [],
    failed: [],
  };
  if (candidates.length === 0) return result;

  const companyId = candidates[0]?.companyId ?? null;
  result.batchId = await createBatch(supabase, {
    companyId,
    actorId,
    label: args.label ?? null,
    total: candidates.length,
  });

  // One account-key lookup per company in the batch (usually exactly one).
  const accountKeys = new Map<string, string>();
  for (const c of candidates) {
    const k = c.companyId ?? "none";
    if (!accountKeys.has(k)) accountKeys.set(k, await resolveAccountKey(supabase, c.companyId));
  }

  const enqueueOne = async (c: BatchCandidate) => {
    try {
      const { data: current, error: readErr } = await supabase
        .from("billing_records")
        .select("id, status, submit_idempotency_key")
        .eq("id", c.id)
        .maybeSingle();

      if (readErr || !current) {
        // Never silently swallow this: it is exactly how a whole batch used to
        // report "0 enqueued" with no explanation.
        const outcome = classifyEnqueueOutcome({ updated: 0, readable: false });
        result.failed.push({ id: c.id, reason: outcome.kind === "enqueued" ? "" : outcome.reason });
        return;
      }

      const status = String(current.status ?? "");
      if (isActiveQueueStatus(status)) {
        result.duplicates.push(c.id);
        return;
      }

      const accountKey = accountKeys.get(c.companyId ?? "none")!;
      const previousKey: string | null = current.submit_idempotency_key ?? null;
      // A retry of the SAME intent keeps its key (so concurrent clicks
      // collapse); an acknowledged resubmission is a new intent.
      const version = c.resubmit ? versionOfKey(previousKey) + 1 : versionOfKey(previousKey);
      const idempotencyKey = buildIdempotencyKey({
        accountKey,
        companyId: c.companyId,
        tripId: c.tripId,
        serviceDate: c.serviceDate,
        version,
      });

      const { data: flipped, error } = await supabase
        .from("billing_records")
        .update({
          status: "queued",
          submission_error: null,
          requires_human_step: false,
          submit_attempt_count: 0,
          // Immediately eligible. No wave hold, no far-future timestamp.
          submit_next_attempt_at: null,
          submit_wave_hold: false,
          submit_locked_until: null,
          submit_worker: null,
          submit_last_error: null,
          submit_heartbeat_at: null,
          failure_stage: null,
          failure_code: null,
          submit_account_key: accountKey,
          submit_idempotency_key: idempotencyKey,
          submit_batch_id: result.batchId,
        })
        .eq("id", c.id)
        .eq("status", status)
        .select("id");

      let statusAfter: string | null = null;
      if (!error && (flipped ?? []).length === 0) {
        // Prove it before calling it a duplicate.
        const { data: after } = await supabase
          .from("billing_records")
          .select("status")
          .eq("id", c.id)
          .maybeSingle();
        statusAfter = (after?.status as string) ?? null;
      }

      const outcome = classifyEnqueueOutcome({
        updated: (flipped ?? []).length,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
        statusAfter,
      });

      if (outcome.kind === "duplicate") {
        result.duplicates.push(c.id);
        return;
      }
      if (outcome.kind === "failed") {
        result.failed.push({ id: c.id, reason: outcome.reason });
        return;
      }

      result.enqueued.push(c.id);
      await logAudit(
        supabase,
        c.id,
        actorId,
        "queued_for_batch_submit",
        `Batch ${result.batchId ?? "adhoc"} · account ${accountKey} · key ${idempotencyKey}`,
      );
    } catch {
      result.failed.push({ id: c.id, reason: "Could not be queued — please try again." });
    }
  };

  for (let i = 0; i < candidates.length; i += CHUNK) {
    await Promise.all(candidates.slice(i, i + CHUNK).map(enqueueOne));
  }

  if (result.batchId) {
    try {
      await supabase
        .from("submission_batches")
        .update({
          total_enqueued: result.enqueued.length,
          total_rejected: result.failed.length,
        })
        .eq("id", result.batchId);
    } catch {
      /* progress bookkeeping only */
    }
  }

  return result;
}

export type BatchProgress = {
  batchId: string;
  label: string | null;
  created_at: string | null;
  total_requested: number;
  queued: number;
  processing: number;
  verifying: number;
  submitted: number;
  needs_attention: number;
  completed: number;
  wave_label: string;
  claim_ids: Array<{ id: string; claim_id: string }>;
  done: boolean;
};

/** Live progress for one batch. Safe fields only — no worker/portal internals. */
export async function getBatchProgress(supabase: any, batchId: string): Promise<BatchProgress> {
  const [{ data: batch }, { data: rows }] = await Promise.all([
    supabase
      .from("submission_batches")
      .select("id, label, created_at, total_requested")
      .eq("id", batchId)
      .maybeSingle(),
    supabase
      .from("billing_records")
      .select("id, status, requires_human_step, state_confirmation_number, submit_wave_hold")
      .eq("submit_batch_id", batchId),
  ]);

  const list = rows ?? [];
  const claim_ids = list
    .filter((r: any) => r.state_confirmation_number)
    .map((r: any) => ({ id: r.id as string, claim_id: String(r.state_confirmation_number) }));

  const count = (fn: (r: any) => boolean) => list.filter(fn).length;
  const verifying = count((r: any) => r.requires_human_step && r.status === "needs_fix");
  const waves = countWave(list);
  const { waveProgressLabel, isWaveBatchDone } = await import("@/lib/submissionWaves");

  const progress: BatchProgress = {
    batchId,
    label: batch?.label ?? null,
    created_at: batch?.created_at ?? null,
    total_requested: Number(batch?.total_requested ?? list.length),
    queued: count((r: any) => r.status === "queued"),
    processing: count((r: any) => r.status === "submitting"),
    verifying,
    submitted: count((r: any) => ["submitted", "paid", "approved"].includes(String(r.status))),
    needs_attention: count((r: any) => r.status === "needs_fix") - verifying,
    completed: waves.completed,
    wave_label: waveProgressLabel(waves),
    claim_ids,
    done: false,
  };
  progress.needs_attention = Math.max(0, progress.needs_attention);
  progress.done = isWaveBatchDone(waves);
  return progress;
}

/** Kept so callers can still show a sane cap in copy; not a gate any more. */
export const displayWaveSize = () => clampWaveSize(DEFAULT_WAVE_SIZE);
