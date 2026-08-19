/**
 * PORTAL SUBMISSION QUEUE (server-side).
 *
 * The automation service runs up to MAX_CONCURRENT_ROBOT_JOBS isolated portal
 * sessions per company at once (proven in production). The queue therefore
 * exists to cap concurrency, not to serialize:
 *
 *   - up to MAX_CONCURRENT_ROBOT_JOBS active robot jobs per company
 *   - anything started while all slots are busy is parked as `queued`
 *   - as jobs reconcile to terminal states, every freed slot is refilled in
 *     one pass, dispatching the oldest queued records in parallel
 */
import { startRobotSubmission, logAudit } from "@/lib/billingHelpers";

/**
 * The automation service hard-kills a job at 480s. Anything older than this is
 * dead as far as the portal session is concerned, so it must never block the
 * queue forever.
 */
export const ROBOT_JOB_STALE_MS = 12 * 60 * 1000;

/**
 * How many portal sessions the automation service can genuinely run at once
 * for a single provider account.
 */
export const MAX_CONCURRENT_ROBOT_JOBS = 8;

const TRIP_SELECT = `id, status, trip_id, company_id,
   medicaid_trips!inner(
     id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
     state_pdf_path, identity_verified, robot_job_id, robot_job_started_at,
     robot_last_status, status, portal_status, robot_confirmation_number,
     submitted_confirmation, vehicle_type, trip_kind, rider_id,
     riders(medicaid_id)
   )`;

/** Billing records whose robot jobs currently hold a live portal session. */
export async function listActiveRobotJobs(
  supabase: any,
  opts: { companyId?: string | null; excludeRecordId?: string } = {},
): Promise<Array<{ id: string; startedAt: string | null }>> {
  let q = supabase
    .from("billing_records")
    .select(`id, medicaid_trips!inner(robot_job_started_at, robot_job_id)`)
    .eq("status", "submitting");
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const now = Date.now();
  const out: Array<{ id: string; startedAt: string | null }> = [];
  for (const r of data ?? []) {
    if (opts.excludeRecordId && r.id === opts.excludeRecordId) continue;
    const trip: any = r.medicaid_trips;
    if (!trip?.robot_job_id) continue;
    const started = trip.robot_job_started_at ? new Date(trip.robot_job_started_at).getTime() : 0;
    if (started && now - started > ROBOT_JOB_STALE_MS) continue; // dead job, not blocking
    out.push({ id: r.id as string, startedAt: trip.robot_job_started_at ?? null });
  }
  return out;
}

/** First active job, or null. Kept for callers that only need "is anything live?". */
export async function findActiveRobotJob(
  supabase: any,
  opts: { companyId?: string | null; excludeRecordId?: string } = {},
): Promise<{ id: string; startedAt: string | null } | null> {
  const active = await listActiveRobotJobs(supabase, opts);
  return active[0] ?? null;
}

/** Free concurrency slots for a company right now. */
export async function availableRobotSlots(
  supabase: any,
  opts: { companyId?: string | null; excludeRecordId?: string } = {},
): Promise<number> {
  const active = await listActiveRobotJobs(supabase, opts);
  return Math.max(0, MAX_CONCURRENT_ROBOT_JOBS - active.length);
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
    mode: "capture" | "submit" | "full" | "debug_confirm_page";
  },
): Promise<{ queued: boolean; ahead: number }> {
  const { billingRecordId, companyId, trip, providerUserId, mode } = args;

  const active = await listActiveRobotJobs(supabase, {
    companyId,
    excludeRecordId: billingRecordId,
  });
  const full = active.length >= MAX_CONCURRENT_ROBOT_JOBS;

  if (full && (mode === "capture" || mode === "debug_confirm_page")) {
    throw new Error(
      `All ${MAX_CONCURRENT_ROBOT_JOBS} portal sessions are busy right now. Try the capture run again in a few minutes.`,
    );
  }

  if (full) {
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
      `All ${MAX_CONCURRENT_ROBOT_JOBS} portal sessions busy. Parked in the queue with ${ahead} job(s) ahead; it starts automatically.`,
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
 * Called after a job reaches a terminal state: fill every free concurrency
 * slot with the oldest queued records, dispatching them in parallel.
 */
export async function dispatchNextQueued(
  supabase: any,
  actorId: string,
  companyId?: string | null,
): Promise<{ started: string | null; startedIds: string[] }> {
  const slots = await availableRobotSlots(supabase, { companyId });
  if (slots <= 0) return { started: null, startedIds: [] };

  let q = supabase
    .from("billing_records")
    .select(TRIP_SELECT)
    .eq("status", "queued")
    .order("updated_at", { ascending: true })
    .limit(slots);
  if (companyId) q = q.eq("company_id", companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const recs: any[] = rows ?? [];
  if (recs.length === 0) return { started: null, startedIds: [] };

  // Claim the rows first so a concurrent sweep cannot pick the same records.
  const claimed: any[] = [];
  for (const rec of recs) {
    const { data: upd } = await supabase
      .from("billing_records")
      .update({ status: "submitting" })
      .eq("id", rec.id)
      .eq("status", "queued")
      .select("id");
    if ((upd ?? []).length > 0) claimed.push(rec);
  }
  if (claimed.length === 0) return { started: null, startedIds: [] };

  // Parallel dispatch — the robot runs these sessions concurrently.
  const results = await Promise.all(
    claimed.map(async (rec: any) => {
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
        return rec.id as string;
      } catch (e: any) {
        const msg = e?.message ?? "Failed to start the queued automation";
        await supabase
          .from("billing_records")
          .update({ status: "needs_fix", submission_error: msg, fix_notes: msg })
          .eq("id", rec.id);
        await logAudit(supabase, rec.id, actorId, "robot_start_failed", msg);
        return null;
      }
    }),
  );

  const startedIds = results.filter((x): x is string => Boolean(x));
  return { started: startedIds[0] ?? null, startedIds };
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
): Promise<{ checked: number; settled: number; started: string | null; startedIds: string[] }> {
  const { reconcileRobotJob } = await import("@/lib/robotReconcile.server");
  const { resolveUnverifiedClaim } = await import("@/lib/unverifiedClaim.server");

  let q = supabase
    .from("billing_records")
    .select(`id, medicaid_trips!inner(robot_job_id, robot_last_status)`)
    .eq("status", "submitting")
    .order("updated_at", { ascending: true });
  if (companyId) q = q.eq("company_id", companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const targets = (rows ?? []).filter((r: any) => r.medicaid_trips?.robot_job_id);
  // Reconcile every in-flight job in parallel: with up to
  // MAX_CONCURRENT_ROBOT_JOBS live jobs, sequential polling delayed each
  // freed slot by the sum of all the polls before it.
  const outcomes = await Promise.all(
    targets.map(async (r: any) => {
      const robotStatus = String(r.medicaid_trips?.robot_last_status ?? "");
      // Already handed to a human — stop the automatic lookups.
      if (robotStatus === "NEEDS_HUMAN_LOOKUP") return false;
      try {
        // Confirm was clicked but the page timed out: treat as still in flight
        // and keep running read-only portal searches until the claim turns up.
        const res =
          robotStatus === "SUBMITTED_UNVERIFIED"
            ? await resolveUnverifiedClaim(supabase, r.id, actorId)
            : await reconcileRobotJob(supabase, r.id, actorId);
        return !res.pending;
      } catch {
        // A single bad record must never stop the sweep.
        return false;
      }
    }),
  );
  const settled = outcomes.filter(Boolean).length;


  const { started, startedIds } = await dispatchNextQueued(supabase, actorId, companyId);
  return { checked: targets.length, settled, started, startedIds };
}
