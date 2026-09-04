/**
 * THE SINGLE RECONCILER FOR "SUBMITTED BUT NO CLAIM NUMBER" (server-only).
 *
 * Queue polling and the recovery sweeps all call this. It attaches a portal
 * confirmation to a bill ONLY against the overwhelming evidence defined in
 * `confirmationReconcile.ts`, in one atomic conditional write, and writes one
 * deduplicated audit line.
 *
 * HARD GUARANTEES
 *   - never calls a submission endpoint, never queues, retries or resubmits;
 *   - never touches `medicaid_trips` (the portal evidence stays exactly as the
 *     robot recorded it);
 *   - never attaches a claim number owned by another bill;
 *   - never touches a corrected resubmission draft (its trip carries the
 *     ORIGINAL denied claim number);
 *   - safe to run every minute: a bill it cannot prove is left untouched and
 *     unlogged, so there is no audit spam and no retry storm.
 */
import { logAuditOnce } from "@/lib/billingHelpers";
import { pickConfirmationNumber } from "@/lib/claimConfirmation";
import {
  CONFIRMATION_RECONCILED_ACTION,
  decideConfirmationReconcile,
  type ConfirmationReconcileDecision,
  type ReconcileAuditEvent,
} from "@/lib/confirmationReconcile";

type Sb = any;

export type ConfirmationReconcileResult = {
  record_id: string;
  kind: "attached" | "noop" | "blocked" | "error";
  claim_number: string | null;
  reason: string;
};

const RECORD_SELECT = `id, status, company_id, trip_id, resubmission_id,
   state_confirmation_number, submitted_at,
   medicaid_trips!inner(id, portal_confirmation, submitted_confirmation,
     robot_confirmation_number, robot_last_status),
   claim_resubmissions!billing_records_resubmission_id_fkey(id, original_claim_number)`;

/** Statuses a bill can be parked in while its confirmation is missing. */
export const RECONCILABLE_STATUSES = [
  "needs_fix",
  "submitting",
  "pending_submit",
  "queued",
  "approved",
] as const;

function tripOf(row: any) {
  const t = row?.medicaid_trips;
  return Array.isArray(t) ? (t[0] ?? null) : (t ?? null);
}

function resubmissionOf(row: any) {
  const r = row?.claim_resubmissions;
  return Array.isArray(r) ? (r[0] ?? null) : (r ?? null);
}

/**
 * Is this exact claim number already owned anywhere in RedArt — by a DIFFERENT
 * billing record, or by a corrected resubmission that was given that claim id?
 * Global on purpose: a claim id is unique at HCPF, so company scoping here
 * would be the very hole that lets one claim be attached twice.
 */
async function claimUsedElsewhere(
  supabase: Sb,
  claimNumber: string,
  recordId: string,
): Promise<boolean> {
  const [bills, corrected] = await Promise.all([
    supabase
      .from("billing_records")
      .select("id")
      .eq("state_confirmation_number", claimNumber)
      .neq("id", recordId)
      .limit(1),
    supabase
      .from("claim_resubmissions")
      .select("id")
      .eq("resubmission_claim_number", claimNumber)
      .limit(1),
  ]);
  return (bills?.data ?? []).length > 0 || (corrected?.data ?? []).length > 0;
}


async function loadAudits(supabase: Sb, recordId: string): Promise<ReconcileAuditEvent[]> {
  const { data } = await supabase
    .from("billing_audit_log")
    .select("action, notes, created_at")
    .eq("billing_record_id", recordId)
    .order("created_at", { ascending: true })
    .limit(300);
  return (data ?? []) as ReconcileAuditEvent[];
}

function outcome(
  recordId: string,
  decision: ConfirmationReconcileDecision,
  kind: ConfirmationReconcileResult["kind"],
): ConfirmationReconcileResult {
  return {
    record_id: recordId,
    kind,
    claim_number:
      decision.kind === "attach" ? decision.claimNumber : (decision.claimNumber ?? null),
    reason: decision.reason,
  };
}

/**
 * Reconcile ONE bill. Idempotent: running it again on an already reconciled
 * bill is a `noop` with no write and no audit line.
 */
export async function reconcileConfirmedSubmission(
  supabase: Sb,
  args: { recordId: string; actorId?: string | null; nowIso?: string; row?: any },
): Promise<ConfirmationReconcileResult> {
  const recordId = args.recordId;
  let row = args.row ?? null;
  if (!row) {
    const { data, error } = await supabase
      .from("billing_records")
      .select(RECORD_SELECT)
      .eq("id", recordId)
      .maybeSingle();
    if (error)
      return { record_id: recordId, kind: "error", claim_number: null, reason: error.message };
    row = data;
  }
  if (!row)
    return { record_id: recordId, kind: "error", claim_number: null, reason: "Bill not found." };

  const trip = tripOf(row);
  const resubmission = resubmissionOf(row);

  // Cheap local pass first: only look up global claim usage when there really
  // is a 13-digit candidate to check.
  const pick = pickConfirmationNumber({
    portal_confirmation: trip?.portal_confirmation ?? null,
    submitted_confirmation: trip?.submitted_confirmation ?? null,
    robot_confirmation_number: trip?.robot_confirmation_number ?? null,
    state_confirmation_number: row.state_confirmation_number ?? null,
  });

  const dryDecision = decideConfirmationReconcile({
    record: row,
    trip,
    audits: [],
    claimUsedByOtherRecord: false,
    originalClaimNumber: resubmission?.original_claim_number ?? null,
  });
  // Anything blocked without needing audit/uniqueness evidence stops here.
  if (dryDecision.kind === "noop") return outcome(recordId, dryDecision, "noop");
  if (dryDecision.kind === "blocked" && !pick.ok) return outcome(recordId, dryDecision, "blocked");
  if (dryDecision.kind === "blocked" && row.resubmission_id)
    return outcome(recordId, dryDecision, "blocked");

  const claimNumber = pick.ok ? pick.claimNumber : "";
  const [used, audits] = await Promise.all([
    claimNumber ? claimUsedElsewhere(supabase, claimNumber, recordId) : Promise.resolve(false),
    loadAudits(supabase, recordId),
  ]);

  const decision = decideConfirmationReconcile({
    record: row,
    trip,
    audits,
    claimUsedByOtherRecord: used,
    originalClaimNumber: resubmission?.original_claim_number ?? null,
  });
  if (decision.kind === "noop") return outcome(recordId, decision, "noop");
  if (decision.kind === "blocked") return outcome(recordId, decision, "blocked");

  const nowIso = args.nowIso ?? new Date().toISOString();
  // ATOMIC: only the writer that still sees an empty confirmation AND the same
  // status wins. A concurrent reconciler or a real portal answer takes
  // precedence and this call becomes a no-op.
  const { data: updated, error } = await supabase
    .from("billing_records")
    .update({
      status: "submitted",
      state_confirmation_number: decision.claimNumber,
      submitted_at: row.submitted_at ?? nowIso,
      requires_human_step: false,
      submission_error: null,
      submit_last_error: null,
      fix_notes: null,
      failure_code: null,
      failure_stage: null,
      // Hand it straight to the READ-ONLY portal status checker.
      status_check_next_at: nowIso,
      status_check_attempts: 0,
      status_check_error: null,
      // Release queue bookkeeping; no retry is ever scheduled.
      submit_locked_until: null,
      submit_worker: null,
      submit_next_attempt_at: null,
    })
    .eq("id", recordId)
    .is("state_confirmation_number", null)
    .eq("status", row.status)
    .select("id");

  if (error)
    return {
      record_id: recordId,
      kind: "error",
      claim_number: decision.claimNumber,
      reason: error.message,
    };
  if (!(updated ?? []).length)
    return {
      record_id: recordId,
      kind: "noop",
      claim_number: decision.claimNumber,
      reason: "Another process reconciled or changed this bill first; nothing was written.",
    };

  await logAuditOnce(
    supabase,
    recordId,
    args.actorId ?? null,
    CONFIRMATION_RECONCILED_ACTION,
    decision.reason,
    "system",
  );

  return {
    record_id: recordId,
    kind: "attached",
    claim_number: decision.claimNumber,
    reason: decision.reason,
  };
}

export type ConfirmationSweepSummary = {
  scanned: number;
  attached: number;
  blocked: number;
  errors: number;
  results: ConfirmationReconcileResult[];
};

/**
 * Sweep the bills that look submitted but carry no claim number.
 * Bounded, idempotent, safe to call from every queue tick.
 */
export async function reconcileConfirmedSubmissions(
  supabase: Sb,
  opts: {
    companyId?: string | null;
    recordIds?: string[] | null;
    actorId?: string | null;
    limit?: number;
  } = {},
): Promise<ConfirmationSweepSummary> {
  const summary: ConfirmationSweepSummary = {
    scanned: 0,
    attached: 0,
    blocked: 0,
    errors: 0,
    results: [],
  };

  let q = supabase
    .from("billing_records")
    .select(RECORD_SELECT)
    .is("state_confirmation_number", null)
    .is("resubmission_id", null)
    .in("status", [...RECONCILABLE_STATUSES])
    .limit(Math.max(1, Math.min(500, opts.limit ?? 200)));
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.recordIds?.length) q = q.in("id", opts.recordIds);

  const { data, error } = await q;
  if (error) {
    summary.errors++;
    return summary;
  }

  for (const row of (data ?? []) as any[]) {
    const trip = tripOf(row);
    // Local pre-filter: no 13-digit candidate means nothing to reconcile and no
    // reason to touch the database at all.
    const pick = pickConfirmationNumber({
      portal_confirmation: trip?.portal_confirmation ?? null,
      submitted_confirmation: trip?.submitted_confirmation ?? null,
      robot_confirmation_number: trip?.robot_confirmation_number ?? null,
      state_confirmation_number: row.state_confirmation_number ?? null,
    });
    if (!pick.ok) continue;

    summary.scanned++;
    try {
      const result = await reconcileConfirmedSubmission(supabase, {
        recordId: row.id,
        actorId: opts.actorId ?? null,
        row,
      });
      summary.results.push(result);
      if (result.kind === "attached") summary.attached++;
      else if (result.kind === "blocked") summary.blocked++;
      else if (result.kind === "error") summary.errors++;
    } catch (e: any) {
      summary.errors++;
      summary.results.push({
        record_id: row.id,
        kind: "error",
        claim_number: null,
        reason: e?.message ?? "reconcile failed",
      });
    }
  }

  return summary;
}
