/**
 * LARGE-BATCH ENQUEUE (server-only).
 *
 * A biller may select 1 or 200+ bills and click Submit once. This module turns
 * that click into durable queue state as fast as possible and then returns —
 * no portal work happens on the request thread.
 *
 * Invariants:
 *   - Every enqueued bill is stamped with the HCPF ACCOUNT KEY it must
 *     serialize on, so all billers of one company share one capacity-limited lane
 *     while other companies run in parallel.
 *   - Every enqueued bill is stamped with an immutable IDEMPOTENCY KEY. The
 *     unique index on that column is what collapses double clicks, refreshes,
 *     extra tabs and two billers picking the same bill into ONE job.
 *   - A bill that is already `queued`/`submitting` is reported as a duplicate,
 *     never re-queued.
 *   - One bad bill can never abort the batch: failures are per-record.
 */
import { buildIdempotencyKey, versionOfKey } from "@/lib/submissionIdempotency";
import { resolveAccountKey } from "@/lib/submissionAccount.server";
import { logAudit } from "@/lib/billingHelpers";
import { DEFAULT_WAVE_SIZE, clampWaveSize, splitIntoWaves } from "@/lib/submissionWaves";
import { countWave, holdBeyondFirstWave } from "@/lib/submissionWaves.server";
import { autoPilotStatusLabel, resolveAutoPilotDefault } from "@/lib/autoPilot";

/**
 * Company-level Auto Pilot preference. New batches inherit it; when a company
 * has never expressed one, Auto Pilot is ON.
 */
export async function resolveCompanyAutoPilot(
  supabase: any,
  companyId: string | null,
): Promise<boolean> {
  if (!companyId) return resolveAutoPilotDefault(undefined);
  try {
    const { data } = await supabase
      .from("billing_settings")
      .select("auto_pilot_default")
      .eq("company_id", companyId)
      .maybeSingle();
    return resolveAutoPilotDefault(data?.auto_pilot_default);
  } catch {
    return resolveAutoPilotDefault(undefined);
  }
}

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
  /** Bills eligible at once; the rest are released automatically in waves. */
  waveSize: number;
  /** Enqueued but held back for a later wave. */
  held: string[];
  /** Whether the next wave will be released automatically. */
  autoPilot: boolean;
};

const ACTIVE_STATUSES = new Set(["queued", "submitting"]);

async function createBatch(
  supabase: any,
  args: {
    companyId: string | null;
    actorId: string | null;
    label: string | null;
    total: number;
    waveSize: number;
    autoPilot: boolean;
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
        wave_size: args.waveSize,
        auto_pilot: args.autoPilot,
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
    /** How many bills of this batch may be eligible at once (default 20). */
    waveSize?: number;
  },
): Promise<BatchEnqueueResult> {
  const { candidates, actorId } = args;
  const result: BatchEnqueueResult = {
    batchId: null,
    enqueued: [],
    duplicates: [],
    failed: [],
    waveSize: clampWaveSize(args.waveSize ?? DEFAULT_WAVE_SIZE),
    held: [],
    autoPilot: true,
  };
  if (candidates.length === 0) return result;

  const companyId = candidates[0]?.companyId ?? null;
  const autoPilot = await resolveCompanyAutoPilot(supabase, companyId);
  result.autoPilot = autoPilot;
  result.batchId = await createBatch(supabase, {
    companyId,
    actorId,
    label: args.label ?? null,
    total: candidates.length,
    waveSize: result.waveSize,
    autoPilot,
  });

  // One account-key lookup per company in the batch (usually exactly one).
  const accountKeys = new Map<string, string>();
  for (const c of candidates) {
    const k = c.companyId ?? "none";
    if (!accountKeys.has(k)) accountKeys.set(k, await resolveAccountKey(supabase, c.companyId));
  }

  await Promise.all(
    candidates.map(async (c) => {
      try {
        const { data: current } = await supabase
          .from("billing_records")
          .select("id, status, submit_idempotency_key")
          .eq("id", c.id)
          .maybeSingle();
        const status = String(current?.status ?? "");
        if (ACTIVE_STATUSES.has(status)) {
          result.duplicates.push(c.id);
          return;
        }

        const accountKey = accountKeys.get(c.companyId ?? "none")!;
        const previousKey: string | null = current?.submit_idempotency_key ?? null;
        const base = {
          accountKey,
          companyId: c.companyId,
          tripId: c.tripId,
          serviceDate: c.serviceDate,
        };
        // A retry of the SAME intent keeps its key (so concurrent clicks
        // collapse); an acknowledged resubmission is a new intent.
        const version = c.resubmit ? versionOfKey(previousKey) + 1 : versionOfKey(previousKey);
        const idempotencyKey = buildIdempotencyKey({ ...base, version });

        const { data: flipped, error } = await supabase
          .from("billing_records")
          .update({
            status: "queued",
            submission_error: null,
            requires_human_step: false,
            submit_attempt_count: 0,
            submit_next_attempt_at: null,
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

        if (error) {
          // 23505 = another request already claimed this exact intent.
          if (String(error.code ?? "") === "23505" || /duplicate key/i.test(String(error.message))) {
            result.duplicates.push(c.id);
            return;
          }
          result.failed.push({ id: c.id, reason: "Could not be queued — please try again." });
          return;
        }
        if ((flipped ?? []).length === 0) {
          result.duplicates.push(c.id);
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
    }),
  );

  // AUTOMATIC WAVES. Everything selected is already durably queued; only the
  // first wave is made eligible for leasing. The scheduler releases the next
  // slice as bills reach terminal outcomes, so a 100-bill batch runs itself
  // without ever making more than `waveSize` bills eligible at once.
  const enqueuedInOrder = candidates
    .map((c) => c.id)
    .filter((id) => result.enqueued.includes(id));
  const { hold } = splitIntoWaves(enqueuedInOrder, result.waveSize);
  if (hold.length) {
    await holdBeyondFirstWave(supabase, hold);
    result.held = hold;
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
  /** Enqueued but held for a later wave. */
  waiting: number;
  wave_size: number;
  completed: number;
  wave_label: string;
  auto_pilot: boolean;
  auto_pilot_label: string;
  claim_ids: Array<{ id: string; claim_id: string }>;
  done: boolean;
};

/** Live progress for one batch. Safe fields only — no worker/portal internals. */
export async function getBatchProgress(supabase: any, batchId: string): Promise<BatchProgress> {
  const [{ data: batch }, { data: rows }] = await Promise.all([
    supabase
      .from("submission_batches")
      .select("id, label, created_at, total_requested, wave_size, auto_pilot")
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
    queued: count((r: any) => r.status === "queued" && !r.submit_wave_hold),
    processing: count((r: any) => r.status === "submitting"),
    verifying,
    submitted: count((r: any) => ["submitted", "paid", "approved"].includes(String(r.status))),
    needs_attention: count((r: any) => r.status === "needs_fix") - verifying,
    waiting: waves.waiting,
    wave_size: clampWaveSize(batch?.wave_size ?? DEFAULT_WAVE_SIZE),
    completed: waves.completed,
    wave_label: waveProgressLabel(waves),
    auto_pilot: batch?.auto_pilot !== false,
    auto_pilot_label: autoPilotStatusLabel(batch?.auto_pilot !== false, waves.waiting),
    claim_ids,
    done: false,
  };
  progress.needs_attention = Math.max(0, progress.needs_attention);
  progress.done = isWaveBatchDone(waves);
  return progress;
}
