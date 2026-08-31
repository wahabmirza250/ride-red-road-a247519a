/**
 * MANUAL HCPF VERIFICATION — the only two ways out of Needs Verification.
 *
 * Both actions are human decisions recorded after the biller searched the
 * portal themselves (Claims → Search Claims). Neither ever submits, retries or
 * enqueues anything, and neither deletes job ids, idempotency keys, account
 * keys or audit history.
 *
 *   A) Claim found     -> reconcile as submitted/verified with the entered
 *                         Claim ID (same shape as the automatic read-only
 *                         lookup resolution).
 *   B) No claim found  -> verified-not-submitted: clear the human-review block
 *                         and move the bill to Ready to Submit. It is NOT
 *                         enqueued; a biller still has to send it.
 */
import { logAudit } from "@/lib/billingHelpers";
import {
  mayReconcileWithProof,
  STALE_WORKER_CLEARED_FIELDS,
  type ReconcileProof,
} from "@/lib/staleWorkerReconcile";
import {
  VERIFIED_NOT_SUBMITTED_STATUS,
  portalServiceDate,
  requiresManualVerification,
} from "@/lib/needsVerification";

type Ctx = {
  rec: any;
  trip: any;
};

async function loadRecord(supabase: any, id: string): Promise<Ctx> {
  const { data, error } = await supabase
    .from("billing_records")
    .select(
      `id, status, trip_id, requires_human_step, submission_error, submit_last_error,
       failure_code, failure_stage, submit_last_error, state_confirmation_number, submit_account_key,
       medicaid_trips!inner(
         id, pickup_at, robot_job_id, robot_last_status,
         robot_confirmation_number, submitted_confirmation,
         riders(full_name, medicaid_id)
       )`,
    )
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return { rec: data, trip: (data as any).medicaid_trips };
}

function assertVerificationCase(ctx: Ctx, proof?: ReconcileProof | null, claimNumber?: string) {
  const { rec, trip } = ctx;
  const candidate = {
    status: rec.status,
    requires_human_step: rec.requires_human_step,
    submission_error: rec.submission_error,
    submit_last_error: rec.submit_last_error,
    failure_code: rec.failure_code,
    state_confirmation_number: rec.state_confirmation_number,
    robot_confirmation_number: trip?.robot_confirmation_number ?? null,
    submitted_confirmation: trip?.submitted_confirmation ?? null,
    robot_last_status: trip?.robot_last_status ?? null,
  };
  if (
    rec.state_confirmation_number ||
    trip?.robot_confirmation_number ||
    trip?.submitted_confirmation
  ) {
    throw new Error("This bill already has a portal claim number — there is nothing to verify.");
  }
  if (!requiresManualVerification(candidate)) {
    // A completed read-only sweep may PROVE exactly one unused final portal
    // claim for this company + member + service date. Against that proof a
    // stale pre-submit "worker stopped" flag is bookkeeping, not a blocker.
    if (mayReconcileWithProof(candidate, proof, String(claimNumber ?? ""))) return;
    throw new Error("This bill is not awaiting manual HCPF verification.");
  }
}

/** (A) The biller found the claim at HCPF and entered its Claim ID. */
export async function recordVerifiedClaimFound(
  supabase: any,
  args: {
    recordId: string;
    actorId: string;
    claimNumber: string;
    acknowledged: boolean;
    reconcileProof?: ReconcileProof | null;
  },
) {
  if (!args.acknowledged)
    throw new Error("Confirm that you searched the HCPF portal before recording a result.");
  const claim = args.claimNumber.trim();
  if (!claim) throw new Error("Enter the Claim ID exactly as shown in the portal.");

  const ctx = await loadRecord(supabase, args.recordId);
  assertVerificationCase(ctx, args.reconcileProof ?? null, claim);

  const nowIso = new Date().toISOString();
  const message = `Manual HCPF verification: biller found claim #${claim} at the portal. Nothing was resubmitted.`;

  const { error: tErr } = await supabase
    .from("medicaid_trips")
    .update({
      status: "submitted",
      robot_last_status: "SUBMITTED",
      robot_last_message: message,
      robot_last_checked_at: nowIso,
      robot_confirmation_number: claim,
      submitted_confirmation: claim,
      portal_confirmation: claim,
      portal_status: "submitted",
      portal_submitted_at: nowIso,
      submitted_at: nowIso,
      submitted_by: args.actorId,
    })
    .eq("id", ctx.trip.id);
  if (tErr) throw new Error(tErr.message);

  const { error: bErr } = await supabase
    .from("billing_records")
    .update({
      status: "submitted",
      state_confirmation_number: claim,
      submitted_at: nowIso,
      // Stale pre-submit worker flags are cleared ONLY here, together with the
      // attached claim — never on their own.
      ...STALE_WORKER_CLEARED_FIELDS,
    })
    .eq("id", ctx.rec.id);
  if (bErr) throw new Error(bErr.message);

  await logAudit(
    supabase,
    ctx.rec.id,
    args.actorId,
    "manual_verification_claim_found",
    `${message} Job ${ctx.trip.robot_job_id ?? "—"} · account ${ctx.rec.submit_account_key ?? "—"} · member ${
      ctx.trip?.riders?.medicaid_id ?? "—"
    } · DOS ${portalServiceDate(ctx.trip?.pickup_at)}.`,
  );

  return { ok: true as const, status: "submitted" as const, claim };
}

/** (B) The biller checked HCPF and there is no claim — safe to resubmit. */
export async function recordVerifiedNoClaim(
  supabase: any,
  args: { recordId: string; actorId: string; acknowledged: boolean; note?: string },
) {
  if (!args.acknowledged)
    throw new Error(
      "You must confirm that you manually searched HCPF for this member and service date.",
    );

  const ctx = await loadRecord(supabase, args.recordId);
  assertVerificationCase(ctx);

  const nowIso = new Date().toISOString();
  const message =
    "Manual HCPF verification: biller searched Claims → Search Claims and found NO claim for this member and service date. " +
    "The bill is safe to submit again; it was moved to Ready to Submit and was NOT enqueued.";

  // Job id, idempotency key and account key are deliberately left untouched.
  const { error: tErr } = await supabase
    .from("medicaid_trips")
    .update({
      status: "approved",
      robot_last_status: VERIFIED_NOT_SUBMITTED_STATUS,
      robot_last_message: message,
      robot_last_checked_at: nowIso,
    })
    .eq("id", ctx.trip.id);
  if (tErr) throw new Error(tErr.message);

  const { error: bErr } = await supabase
    .from("billing_records")
    .update({
      status: "approved",
      requires_human_step: false,
      submission_error: null,
      submit_last_error: null,
      failure_code: null,
      failure_stage: null,
      auto_retry_count: 0,
      submit_next_attempt_at: null,
      reviewed_by: args.actorId,
      reviewed_at: nowIso,
    })
    .eq("id", ctx.rec.id);
  if (bErr) throw new Error(bErr.message);

  await logAudit(
    supabase,
    ctx.rec.id,
    args.actorId,
    "manual_verification_no_claim",
    `${message} Job ${ctx.trip.robot_job_id ?? "—"} · account ${ctx.rec.submit_account_key ?? "—"} · member ${
      ctx.trip?.riders?.medicaid_id ?? "—"
    } · DOS ${portalServiceDate(ctx.trip?.pickup_at)}.${args.note ? ` Note: ${args.note}` : ""}`,
  );

  return { ok: true as const, status: "approved" as const };
}
