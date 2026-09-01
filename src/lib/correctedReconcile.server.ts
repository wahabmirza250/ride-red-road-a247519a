/**
 * CORRECTED-RESUBMISSION RECONCILIATION (server-only).
 *
 * Polls the EXISTING robot job of a corrected claim and writes the outcome to
 * the corrected billing record and its linked `claim_resubmissions` row — and
 * to nothing else.
 *
 * HARD GUARANTEES (2026-08-31 22:16 UTC incident):
 *   - it NEVER dispatches, resends or creates a robot job; it only polls the
 *     `robot_job_id` already stored on the trip, at its sticky worker URL;
 *   - it NEVER writes `medicaid_trips` — the original trip keeps its
 *     `robot_confirmation_number`, `submitted_confirmation`,
 *     `portal_confirmation`, status and history byte for byte;
 *   - it NEVER writes the original denied billing record;
 *   - a corrected claim counts as submitted ONLY with a NEW confirmation
 *     number that differs from `original_claim_number`;
 *   - anything lost, ambiguous, or answered with the ORIGINAL claim number is
 *     held for manual HCPF verification and is never retried automatically.
 */
import { logAudit } from "@/lib/billingHelpers";
import {
  CORRECTED_AMBIGUOUS_CODE,
  CORRECTED_CEILING_CODE,
  CORRECTED_CEILING_MESSAGE,
  CORRECTED_FAILURE_STAGE,
  CORRECTED_JOB_LOST_CODE,
  CORRECTED_JOB_LOST_MARKER,
  CORRECTED_JOB_LOST_MESSAGE,
  CORRECTED_JOB_LOST_WAIT_MESSAGE,
  CORRECTED_NO_JOB_MESSAGE,
  CORRECTED_PRESUBMIT_CODE,
  classifyCorrectedJob,
  correctedLostJobStep,
} from "@/lib/correctedJob";
import {
  releaseResubmissionToReady,
  writeResubmissionEvent,
} from "@/lib/resubmissionLifecycle.server";

type Sb = any;

export type CorrectedReconcileResult = {
  pending: boolean;
  status: string;
  message: string | null;
  confirmation_number?: string | null;
  /** Marks the result as fully handled by the corrected path. */
  corrected: true;
  resubmission_id: string;
};

/** Everything the corrected reconciler needs about one bill. */
export const CORRECTED_RECORD_SELECT = `id, status, trip_id, resubmission_id, state_confirmation_number,
   medicaid_trips!inner(
     id, robot_job_id, robot_worker_id, robot_worker_url, robot_pass,
     robot_last_status, robot_last_message, robot_last_checked_at, robot_job_started_at
   )`;

export type CorrectedRecordRow = {
  id: string;
  status?: string | null;
  trip_id?: string | null;
  resubmission_id: string;
  state_confirmation_number?: string | null;
};

function done(
  resubmissionId: string,
  status: string,
  message: string | null,
  confirmation?: string | null,
): CorrectedReconcileResult {
  return {
    pending: false,
    status,
    message,
    confirmation_number: confirmation ?? null,
    corrected: true,
    resubmission_id: resubmissionId,
  };
}

function still(
  resubmissionId: string,
  status: string,
  message: string | null,
): CorrectedReconcileResult {
  return { pending: true, status, message, corrected: true, resubmission_id: resubmissionId };
}

/* ------------------------------------------------------------------ */
/* Writers — corrected record + corrected draft ONLY, never the trip.  */
/* ------------------------------------------------------------------ */

/**
 * VERIFICATION HOLD. The corrected claim leaves the automation queue and waits
 * for a person to check HCPF. The draft stays `processing`, so it can never
 * reappear in Ready to Submit and can never be picked up by Auto Pilot.
 */
export async function holdCorrectedForVerification(
  supabase: Sb,
  args: {
    recordId: string;
    resubmissionId: string;
    companyId?: string | null;
    message: string;
    failureCode: string;
    actorId?: string | null;
    auditAction?: string;
  },
): Promise<void> {
  await supabase
    .from("billing_records")
    .update({
      status: "needs_fix",
      requires_human_step: true,
      submission_error: args.message,
      submit_last_error: args.message.slice(0, 500),
      fix_notes: args.message,
      failure_stage: CORRECTED_FAILURE_STAGE,
      failure_code: args.failureCode,
      // Release the app-side lease only. No automatic retry is ever scheduled.
      submit_locked_until: null,
      submit_worker: null,
      submit_next_attempt_at: null,
    })
    .eq("id", args.recordId);

  await supabase
    .from("claim_resubmissions")
    .update({ failure_reason: args.message })
    .eq("id", args.resubmissionId)
    .eq("status", "processing");

  await logAudit(
    supabase,
    args.recordId,
    args.actorId ?? null,
    args.auditAction ?? "corrected_claim_needs_verification",
    args.message,
  );
  await writeResubmissionEvent(supabase, {
    resubmission_id: args.resubmissionId,
    company_id: args.companyId ?? null,
    actor_id: args.actorId ?? null,
    action: "resubmission_needs_verification",
    notes: args.message,
  });
}

/** The ONE success path: a NEW claim number, written to the corrected rows. */
export async function markCorrectedSubmitted(
  supabase: Sb,
  args: {
    recordId: string;
    resubmissionId: string;
    companyId?: string | null;
    claimNumber: string;
    message: string;
    actorId?: string | null;
    nowIso: string;
  },
): Promise<void> {
  await supabase
    .from("billing_records")
    .update({
      status: "submitted",
      state_confirmation_number: args.claimNumber,
      submitted_at: args.nowIso,
      submission_error: null,
      submit_last_error: null,
      fix_notes: null,
      requires_human_step: false,
      failure_stage: null,
      failure_code: null,
      // Hand it straight to the read-only portal status checker.
      status_check_next_at: args.nowIso,
      status_check_attempts: 0,
      status_check_error: null,
      submit_locked_until: null,
      submit_worker: null,
      submit_next_attempt_at: null,
    })
    .eq("id", args.recordId);

  await supabase
    .from("claim_resubmissions")
    .update({
      status: "submitted",
      resubmission_claim_number: args.claimNumber,
      submitted_at: args.nowIso,
      submitted_by: args.actorId ?? null,
      failure_reason: null,
    })
    .eq("id", args.resubmissionId)
    .eq("status", "processing");

  await logAudit(
    supabase,
    args.recordId,
    args.actorId ?? null,
    "corrected_claim_submitted",
    args.message,
  );
  await writeResubmissionEvent(supabase, {
    resubmission_id: args.resubmissionId,
    company_id: args.companyId ?? null,
    actor_id: args.actorId ?? null,
    action: "resubmission_confirmed",
    notes: args.message,
  });
}

/** PROVEN pre-Submit failure: the corrected draft goes back to Ready to Submit. */
async function releaseCorrectedToReady(
  supabase: Sb,
  args: {
    recordId: string;
    resubmissionId: string;
    companyId?: string | null;
    message: string;
    actorId?: string | null;
  },
): Promise<void> {
  await supabase
    .from("billing_records")
    .update({
      // Re-queueable, but never automatically: the draft is what gets selected.
      status: "pending_submit",
      requires_human_step: false,
      submission_error: args.message,
      submit_last_error: args.message.slice(0, 500),
      fix_notes: null,
      failure_stage: "pre_submit",
      failure_code: CORRECTED_PRESUBMIT_CODE,
      submit_locked_until: null,
      submit_worker: null,
      submit_next_attempt_at: null,
    })
    .eq("id", args.recordId);

  await releaseResubmissionToReady(supabase, args.resubmissionId, args.message);

  await logAudit(
    supabase,
    args.recordId,
    args.actorId ?? null,
    "corrected_claim_returned_to_ready",
    args.message,
  );
  await writeResubmissionEvent(supabase, {
    resubmission_id: args.resubmissionId,
    company_id: args.companyId ?? null,
    actor_id: args.actorId ?? null,
    action: "resubmission_returned_to_ready",
    notes: args.message,
  });
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

export async function reconcileCorrectedRobotJob(
  supabase: Sb,
  args: {
    record: CorrectedRecordRow;
    trip: any;
    actorId?: string | null;
    now?: number;
  },
): Promise<CorrectedReconcileResult> {
  const rec = args.record;
  const trip = args.trip ?? {};
  const resubmissionId = rec.resubmission_id;
  const now = args.now ?? Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: res } = await supabase
    .from("claim_resubmissions")
    .select(
      "id, company_id, status, original_claim_number, original_trip_id, resubmission_claim_number, failure_reason, updated_at",
    )
    .eq("id", resubmissionId)
    .maybeSingle();

  if (!res) {
    return done(
      resubmissionId,
      "no_resubmission",
      "The corrected claim draft linked to this bill no longer exists.",
    );
  }

  // Already resolved — nothing to poll, nothing to write.
  if (rec.state_confirmation_number) {
    return done(
      resubmissionId,
      "submitted",
      `The corrected claim already has confirmation #${rec.state_confirmation_number}.`,
      rec.state_confirmation_number,
    );
  }
  if (String(res.status ?? "") !== "processing") {
    return done(
      resubmissionId,
      String(res.status ?? "unknown"),
      "This corrected claim is not being processed by the automation.",
      res.resubmission_claim_number ?? null,
    );
  }

  const jobId: string | null = trip?.robot_job_id ?? null;
  if (!jobId) {
    // No job was ever recorded, so nothing can have been sent. Deliberately
    // no write here: the caller (Ready to Submit / Auto Pilot) owns that.
    return done(resubmissionId, "no_job", CORRECTED_NO_JOB_MESSAGE);
  }

  // STICKY POLL of the EXISTING job. Never a dispatch.
  const { pollBaseUrlFor } = await import("@/lib/robotFleet.server");
  const pollBase = pollBaseUrlFor(trip);
  let httpStatus = 0;
  let text = "";
  let body: any = undefined;
  try {
    const r = await fetch(`${pollBase}/job-status/${encodeURIComponent(jobId)}`, { method: "GET" });
    httpStatus = r.status;
    text = await r.text();
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON answers are handled by the classifier */
    }
  } catch (e) {
    return still(
      resubmissionId,
      "poll_error",
      `The automation service could not be reached: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const decision = classifyCorrectedJob({
    httpStatus,
    bodyText: text,
    body,
    originalClaimNumber: res.original_claim_number,
  });

  if (decision.kind === "poll_error" || decision.kind === "pending") {
    return still(resubmissionId, decision.status, decision.message);
  }

  if (decision.kind === "job_lost") {
    const step = correctedLostJobStep({
      failureReason: res.failure_reason,
      markedAt: res.updated_at,
      now,
    });
    if (step === "mark") {
      await supabase
        .from("claim_resubmissions")
        .update({ failure_reason: `${CORRECTED_JOB_LOST_MARKER} ${CORRECTED_JOB_LOST_WAIT_MESSAGE}` })
        .eq("id", resubmissionId)
        .eq("status", "processing");
      return still(resubmissionId, decision.status, CORRECTED_JOB_LOST_WAIT_MESSAGE);
    }
    if (step === "wait") {
      // Deliberately no write: it would reset the confirmation window.
      return still(resubmissionId, decision.status, CORRECTED_JOB_LOST_WAIT_MESSAGE);
    }
    await holdCorrectedForVerification(supabase, {
      recordId: rec.id,
      resubmissionId,
      companyId: res.company_id,
      message: CORRECTED_JOB_LOST_MESSAGE,
      failureCode: CORRECTED_JOB_LOST_CODE,
      actorId: args.actorId ?? null,
      auditAction: "corrected_job_lost_needs_verification",
    });
    return done(resubmissionId, "CORRECTED_JOB_LOST", CORRECTED_JOB_LOST_MESSAGE);
  }

  if (decision.kind === "new_claim" && decision.claimNumber) {
    await markCorrectedSubmitted(supabase, {
      recordId: rec.id,
      resubmissionId,
      companyId: res.company_id,
      claimNumber: decision.claimNumber,
      message: decision.message,
      actorId: args.actorId ?? null,
      nowIso,
    });
    return done(resubmissionId, "submitted", decision.message, decision.claimNumber);
  }

  if (decision.kind === "presubmit_failed") {
    await releaseCorrectedToReady(supabase, {
      recordId: rec.id,
      resubmissionId,
      companyId: res.company_id,
      message: decision.message,
      actorId: args.actorId ?? null,
    });
    return done(resubmissionId, decision.status, decision.message);
  }

  // original_reuse + every ambiguous outcome.
  await holdCorrectedForVerification(supabase, {
    recordId: rec.id,
    resubmissionId,
    companyId: res.company_id,
    message: decision.message,
    failureCode: decision.failureCode ?? CORRECTED_AMBIGUOUS_CODE,
    actorId: args.actorId ?? null,
    auditAction:
      decision.kind === "original_reuse"
        ? "corrected_claim_original_number_reused"
        : "corrected_claim_needs_verification",
  });
  return done(resubmissionId, decision.status, decision.message);
}

/**
 * RECOVERY SWEEP for corrected claims that were really dispatched but never
 * reconciled (the whole 2026-08-31 batch). Driven from the corrected DRAFT, so
 * it also picks up corrected records an older build had already pushed into
 * Needs Fix. Read-only towards the automation service: it polls, never sends.
 */
export async function recoverCorrectedInFlight(
  supabase: Sb,
  opts: { companyId?: string | null; actorId?: string | null; limit?: number } = {},
): Promise<{ checked: number; settled: number }> {
  let q = supabase
    .from("claim_resubmissions")
    .select("id, company_id")
    .eq("status", "processing")
    .limit(Math.max(1, Math.min(opts.limit ?? 100, 500)));
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data: drafts, error } = await q;
  if (error || !drafts?.length) return { checked: 0, settled: 0 };

  const ids = drafts.map((d: any) => d.id as string);
  const { data: recs, error: recErr } = await supabase
    .from("billing_records")
    .select(CORRECTED_RECORD_SELECT)
    .in("resubmission_id", ids);
  if (recErr || !recs?.length) return { checked: 0, settled: 0 };

  const targets = (recs as any[]).filter(
    (r) => !r.state_confirmation_number && r.medicaid_trips?.robot_job_id,
  );

  const outcomes = await Promise.all(
    targets.map(async (r) => {
      try {
        const out = await reconcileCorrectedRobotJob(supabase, {
          record: r as CorrectedRecordRow,
          trip: r.medicaid_trips,
          actorId: opts.actorId ?? null,
        });
        return !out.pending;
      } catch {
        // One bad corrected claim must never stop the sweep.
        return false;
      }
    }),
  );

  return { checked: targets.length, settled: outcomes.filter(Boolean).length };
}

/**
 * A corrected claim that blew through the absolute in-flight ceiling. Never a
 * retry: it becomes a verification hold on the corrected rows alone.
 */
export async function holdCorrectedForCeiling(
  supabase: Sb,
  args: { recordId: string; resubmissionId: string; companyId?: string | null; actorId?: string | null },
): Promise<void> {
  await holdCorrectedForVerification(supabase, {
    recordId: args.recordId,
    resubmissionId: args.resubmissionId,
    companyId: args.companyId ?? null,
    message: CORRECTED_CEILING_MESSAGE,
    failureCode: CORRECTED_CEILING_CODE,
    actorId: args.actorId ?? null,
    auditAction: "corrected_inflight_ceiling_needs_verification",
  });
}
