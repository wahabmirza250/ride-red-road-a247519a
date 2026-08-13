/**
 * PORTAL SUBMISSION QUEUE (server-side).
 *
 * The state portal allows exactly ONE live session per provider account, and
 * the automation service serializes nothing for us: firing two jobs seconds
 * apart makes both fight over the same session and the loser dies with
 * "Job timed out after 480s".
 *
 * With several billers working the same account all day this happens by
 * accident, so submissions are gated here:
 *
 *   - one active robot job per company at a time
 *   - anything started while a job is live is parked as `queued`
 *   - as soon as a job reconciles to a terminal state, the oldest queued
 *     record is dispatched automatically
 *
 * Never used for `capture` runs: those are test/diagnostic passes and must
 * fail loudly rather than sit in a queue.
 */
import { startRobotSubmission, logAudit } from "@/lib/billingHelpers";

/**
 * The automation service hard-kills a job at 480s. Anything older than this is
 * dead as far as the portal session is concerned, so it must never block the
 * queue forever.
 */
export const ROBOT_JOB_STALE_MS = 12 * 60 * 1000;

const TRIP_SELECT = `id, status, trip_id, company_id,
   medicaid_trips!inner(
     id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
     state_pdf_path, identity_verified, robot_job_id, robot_job_started_at,
     robot_last_status, status, portal_status, robot_confirmation_number,
     submitted_confirmation, vehicle_type, trip_kind, rider_id,
     riders(medicaid_id)
   )`;

/** The billing record whose robot job currently owns the portal session. */
export async function findActiveRobotJob(
  supabase: any,
  opts: { companyId?: string | null; excludeRecordId?: string } = {},
): Promise<{ id: string; startedAt: string | null } | null> {
  let q = supabase
    .from("billing_records")
    .select(`id, medicaid_trips!inner(robot_job_started_at, robot_job_id)`)
    .eq("status", "submitting");
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const now = Date.now();
  for (const r of data ?? []) {
    if (opts.excludeRecordId && r.id === opts.excludeRecordId) continue;
    const trip: any = r.medicaid_trips;
    if (!trip?.robot_job_id) continue;
    const started = trip.robot_job_started_at ? new Date(trip.robot_job_started_at).getTime() : 0;
    if (started && now - started > ROBOT_JOB_STALE_MS) continue; // dead job, not blocking
    return { id: r.id as string, startedAt: trip.robot_job_started_at ?? null };
  }
  return null;
}

/** How many records are parked in front of this one. */
export async function queuedAhead(
  supabase: any,
  companyId: string | null | undefined,
  recordId: string,
): Promise<number> {
  let q = supabase
    .from("billing_records")
    .select("id, updated_at")
    .eq("status", "queued")
    .order("updated_at", { ascending: true });
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q;
  const idx = (data ?? []).findIndex((r: any) => r.id === recordId);
  return idx < 0 ? (data ?? []).length : idx;
}

/**
 * Start the robot for a record, or park it behind the job that currently owns
 * the portal session.
 */
export async function enqueueOrStartRobot(
  supabase: any,
  args: {
    billingRecordId: string;
    companyId: string | null | undefined;
    trip: any;
    providerUserId: string;
    mode: "capture" | "submit" | "full";
  },
): Promise<{ queued: boolean; ahead: number }> {
  const { billingRecordId, companyId, trip, providerUserId, mode } = args;

  const active = await findActiveRobotJob(supabase, {
    companyId,
    excludeRecordId: billingRecordId,
  });

  if (active && mode === "capture") {
    throw new Error(
      "The portal session is busy with another submission right now. Try the capture run again in a few minutes.",
    );
  }

  if (active) {
    await supabase
      .from("billing_records")
      .update({
        status: "queued",
        submission_error: null,
        requires_human_step: false,
      })
      .eq("id", billingRecordId);
    const ahead = await queuedAhead(supabase, companyId, billingRecordId);
    await logAudit(
      supabase,
      billingRecordId,
      providerUserId,
      "queued_behind_active_job",
      `Portal session busy (record ${active.id}). Parked in the queue with ${ahead} job(s) ahead; it starts automatically.`,
    );
    return { queued: true, ahead };
  }

  await startRobotSubmission(supabase, {
    billingRecordId,
    trip,
    providerUserId,
    mode,
  });
  return { queued: false, ahead: 0 };
}

/**
 * Called after a job reaches a terminal state: hand the freed portal session
 * to the oldest queued record, if any.
 */
export async function dispatchNextQueued(
  supabase: any,
  actorId: string,
  companyId?: string | null,
): Promise<{ started: string | null }> {
  const active = await findActiveRobotJob(supabase, { companyId });
  if (active) return { started: null };

  let q = supabase
    .from("billing_records")
    .select(TRIP_SELECT)
    .eq("status", "queued")
    .order("updated_at", { ascending: true })
    .limit(1);
  if (companyId) q = q.eq("company_id", companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const rec: any = (rows ?? [])[0];
  if (!rec) return { started: null };

  try {
    await startRobotSubmission(supabase, {
      billingRecordId: rec.id,
      trip: rec.medicaid_trips,
      providerUserId: actorId,
      // Queued work is always a real one-shot submission; capture runs are
      // never queued (see enqueueOrStartRobot).
      mode: "full",
    });
    await logAudit(supabase, rec.id, actorId, "robot_started_from_queue");
    return { started: rec.id as string };
  } catch (e: any) {
    const msg = e?.message ?? "Failed to start the queued automation";
    await supabase
      .from("billing_records")
      .update({ status: "needs_fix", submission_error: msg, fix_notes: msg })
      .eq("id", rec.id);
    await logAudit(supabase, rec.id, actorId, "robot_start_failed", msg);
    return { started: null };
  }
}

/**
 * BACKGROUND SWEEP.
 *
 * Reconciles every in-flight job, then releases the queue. Runs from the
 * billing app on a timer AND from the cron endpoint, so a finished job lands
 * within seconds no matter which screen (if any) is open.
 */
export async function sweepRobotJobs(
  supabase: any,
  actorId: string,
  companyId?: string | null,
): Promise<{ checked: number; settled: number; started: string | null }> {
  const { reconcileRobotJob } = await import("@/lib/robotReconcile.server");

  let q = supabase
    .from("billing_records")
    .select(`id, medicaid_trips!inner(robot_job_id)`)
    .eq("status", "submitting")
    .order("updated_at", { ascending: true });
  if (companyId) q = q.eq("company_id", companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  let settled = 0;
  const targets = (rows ?? []).filter((r: any) => r.medicaid_trips?.robot_job_id);
  for (const r of targets) {
    try {
      const res = await reconcileRobotJob(supabase, r.id, actorId);
      if (!res.pending) settled += 1;
    } catch {
      // A single bad record must never stop the sweep.
    }
  }

  const { started } = await dispatchNextQueued(supabase, actorId, companyId);
  return { checked: targets.length, settled, started };
}
