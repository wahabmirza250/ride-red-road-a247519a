/**
 * PORTAL SUBMISSION QUEUE (server-side).
 *
 * The automation service runs up to MAX_CONCURRENT_ROBOT_JOBS isolated portal
 * sessions per company account at once. The queue therefore exists to cap
 * concurrency, not to serialize:
 *
 *   - up to MAX_CONCURRENT_ROBOT_JOBS active robot jobs per company
 *   - anything started while all slots are busy is parked as `queued`
 *   - as jobs reconcile to terminal states, every freed slot is refilled in
 *     one pass, dispatching the oldest queued records in parallel
 */
import { startRobotSubmission, logAudit } from "@/lib/billingHelpers";
import { envInt } from "@/lib/submissionQueueEnv";


/**
 * The automation service hard-kills a job at 480s. Anything older than this is
 * dead as far as the portal session is concerned, so it must never block the
 * queue forever.
 */
export const ROBOT_JOB_STALE_MS = 12 * 60 * 1000;

/**
 * CONTROLLED ACCOUNT CAPACITY: up to this many live portal sessions per
 * provider/company account.
 *
 * Single source of truth with the queue layer: same env var, same 1..8 clamp,
 * same default of 4. The automation service's own server caps at 8, so RedArt
 * can never ask it for more than it supports, and the default keeps one tenant
 * from flooding the worker (Chromium spawn EAGAIN, closed browsers, 480s
 * timeouts). Extra approved bills wait in the persistent queue and start as
 * soon as an account slot frees up.
 */
export const MAX_CONCURRENT_ROBOT_JOBS = envInt("SUBMIT_MAX_PER_COMPANY", 4, 1, 8);



/**
 * PER-PASSENGER SINGLE FLIGHT.
 *
 * Grouping several bills for the same member and submitting them together is
 * the normal workflow, but two simultaneous portal sessions touching ONE member
 * record are both a duplicate risk and a reliable source of 480s timeouts. So a
 * passenger only ever has ONE live job, no matter how many account slots are
 * free; the rest park as `queued` and follow automatically.
 */
export const MAX_CONCURRENT_JOBS_PER_RIDER = 1;

/** Stable per-passenger key: rider row first, Medicaid ID as a fallback. */
export function riderKeyOf(trip: any): string | null {
  if (!trip) return null;
  const rid = trip.rider_id ?? null;
  if (rid) return `rider:${rid}`;
  const mid = trip.riders?.medicaid_id ?? trip.medicaid_id ?? null;
  return mid ? `mid:${String(mid).trim().toUpperCase()}` : null;
}

const TRIP_SELECT = `id, status, trip_id, company_id,
   medicaid_trips!inner(
     id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
     state_pdf_path, identity_verified, robot_job_id, robot_job_started_at,
     robot_last_status, status, portal_status, robot_confirmation_number,
     submitted_confirmation, vehicle_type, trip_kind, rider_id, created_by,
     riders(medicaid_id)
   )`;

/**
 * PROVIDER IDENTITY FOR BACKGROUND WORK.
 *
 * The robot needs a real provider user id on every payload — it looks the
 * company's billing rates up with it. Interactive submissions pass the signed
 * in biller, but the cron sweep has no session, and passing its null through
 * made the robot fail every dispatched job with "No provider_id on this trip."
 * So resolve a real human for the record: whoever created the trip, else a
 * biller/admin of the owning company.
 */
export async function resolveProviderUserId(
  supabase: any,
  args: { actorId?: string | null; trip?: any; companyId?: string | null },
): Promise<string> {
  if (args.actorId) return args.actorId;

  const creator = args.trip?.created_by ?? null;
  if (creator) return creator as string;

  const companyId = args.companyId ?? args.trip?.company_id ?? null;
  if (companyId) {
    const { data } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", companyId)
      .in("role", ["admin_biller", "billing", "admin"])
      .limit(20);
    const order = ["admin_biller", "billing", "admin"];
    const pick = (data ?? []).sort(
      (a: any, b: any) => order.indexOf(a.role) - order.indexOf(b.role),
    )[0];
    if (pick?.user_id) return pick.user_id as string;
  }

  throw new Error(
    "No provider account could be resolved for this bill — the automation needs a billing user on the company.",
  );
}


/** Billing records whose robot jobs currently hold a live portal session. */
export async function listActiveRobotJobs(
  supabase: any,
  opts: { companyId?: string | null; excludeRecordId?: string } = {},
): Promise<Array<{ id: string; startedAt: string | null; riderKey: string | null }>> {
  let q = supabase
    .from("billing_records")
    .select(
      `id, medicaid_trips!inner(robot_job_started_at, robot_job_id, rider_id, riders(medicaid_id))`,
    )
    .eq("status", "submitting");
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const now = Date.now();
  const out: Array<{ id: string; startedAt: string | null; riderKey: string | null }> = [];
  for (const r of data ?? []) {
    if (opts.excludeRecordId && r.id === opts.excludeRecordId) continue;
    const trip: any = r.medicaid_trips;
    if (!trip?.robot_job_id) continue;
    const started = trip.robot_job_started_at ? new Date(trip.robot_job_started_at).getTime() : 0;
    if (started && now - started > ROBOT_JOB_STALE_MS) continue; // dead job, not blocking
    out.push({
      id: r.id as string,
      startedAt: trip.robot_job_started_at ?? null,
      riderKey: riderKeyOf(trip),
    });
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
 * SINGLE ENTRY POINT FOR AN INTERACTIVE SUBMISSION.
 *
 * A real submission is never started straight from a click. The bill is first
 * persisted as `queued` with a conditional (idempotent) status flip, and the
 * atomic account lease decides whether it may start now. That makes
 * double clicks, page refreshes, several open tabs and background polling all
 * collapse onto the same queued row instead of opening extra portal sessions.
 *
 * Capture / diagnostic runs never submit, so they keep their old behaviour of
 * refusing to start while a session is live.
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
): Promise<{ queued: boolean; ahead: number; duplicate?: boolean }> {
  const { billingRecordId, companyId, trip, providerUserId, mode } = args;

  const active = await listActiveRobotJobs(supabase, {
    companyId,
    excludeRecordId: billingRecordId,
  });
  const globalFull = active.length >= MAX_CONCURRENT_ROBOT_JOBS;
  const key = riderKeyOf(trip);
  const riderActive = key ? active.filter((a) => a.riderKey === key).length : 0;
  const riderFull = Boolean(key) && riderActive >= MAX_CONCURRENT_JOBS_PER_RIDER;

  if ((globalFull || riderFull) && (mode === "capture" || mode === "debug_confirm_page")) {
    throw new Error(
      "A portal session is already running on this account. Try the capture run again in a few minutes.",
    );
  }
  if (mode === "capture" || mode === "debug_confirm_page") {
    await startRobotSubmission(supabase, { billingRecordId, trip, providerUserId, mode });
    return { queued: false, ahead: 0 };
  }

  // IDEMPOTENT ENQUEUE. Read the current status, then flip it only if it is
  // still that same status: a second concurrent click loses the race and is
  // reported as a duplicate rather than starting a second job.
  const { data: current } = await supabase
    .from("billing_records")
    .select("id, status")
    .eq("id", billingRecordId)
    .maybeSingle();
  const currentStatus = String(current?.status ?? "");

  if (currentStatus === "submitting" || currentStatus === "queued") {
    const ahead = await queuedAhead(supabase, companyId, billingRecordId);
    return { queued: true, ahead, duplicate: true };
  }

  // Account key + idempotency key: an interactive click on a single bill uses
  // the exact same lane and the same duplicate collapsing as a large batch.
  const { resolveAccountKey } = await import("@/lib/submissionAccount.server");
  const { buildIdempotencyKey, versionOfKey } = await import("@/lib/submissionIdempotency");
  const accountKey = await resolveAccountKey(supabase, companyId ?? trip?.company_id ?? null);
  const { data: keyRow } = await supabase
    .from("billing_records")
    .select("submit_idempotency_key")
    .eq("id", billingRecordId)
    .maybeSingle();
  const priorClaim = trip?.robot_confirmation_number ?? trip?.submitted_confirmation ?? null;
  const idempotencyKey = buildIdempotencyKey({
    accountKey,
    companyId: companyId ?? trip?.company_id ?? null,
    tripId: trip?.id ?? billingRecordId,
    serviceDate: trip?.pickup_at ?? null,
    // A deliberate resubmission of an already-claimed bill is a new intent.
    version: versionOfKey(keyRow?.submit_idempotency_key ?? null) + (priorClaim ? 1 : 0),
  });

  const { data: flipped } = await supabase
    .from("billing_records")
    .update({
      status: "queued",
      submit_account_key: accountKey,
      submit_idempotency_key: idempotencyKey,
      failure_stage: null,
      failure_code: null,
      submission_error: null,
      requires_human_step: false,
      submit_attempt_count: 0,
      submit_next_attempt_at: null,
      submit_locked_until: null,
      submit_worker: null,
      submit_last_error: null,
    })
    .eq("id", billingRecordId)
    .eq("status", currentStatus)
    .select("id");
  if ((flipped ?? []).length === 0) {
    // Someone else already moved this row — treat as the same request.
    const ahead = await queuedAhead(supabase, companyId, billingRecordId);
    return { queued: true, ahead, duplicate: true };
  }

  // Ask the single-flight dispatcher to start it now if the account is free.
  const { dispatchLeasedSubmissions } = await import("@/lib/submissionQueue.server");
  const res = await dispatchLeasedSubmissions(supabase, providerUserId, {
    companyId: companyId ?? null,
    recordIds: [billingRecordId],
    worker: `interactive-${String(providerUserId).slice(0, 8)}`,
    mode,
  });
  if (res.startedIds.includes(billingRecordId)) return { queued: false, ahead: 0 };

  const ahead = await queuedAhead(supabase, companyId, billingRecordId);
  await logAudit(
    supabase,
    billingRecordId,
    providerUserId,
    "queued_behind_active_job",
    `This provider account is at its active submission capacity. Parked in the queue with ${ahead} job(s) ahead; it starts automatically.`,
  );
  return { queued: true, ahead };
}



/**
 * Called after a job reaches a terminal state: lease and dispatch the oldest
 * queued records through the persistent, crash-safe queue layer
 * (`submissionQueue.server.ts`). Kept as the stable entry point used by the
 * reconciler, the billing app and the cron sweep.
 */
export async function dispatchNextQueued(
  supabase: any,
  actorId: string | null,
  companyId?: string | null,
): Promise<{ started: string | null; startedIds: string[] }> {
  const { dispatchLeasedSubmissions } = await import("@/lib/submissionQueue.server");
  const { startedIds } = await dispatchLeasedSubmissions(supabase, actorId, { companyId });
  return { started: startedIds[0] ?? null, startedIds };
}

/**
 * Reconcile every in-flight robot job for a company. Unchanged behaviour —
 * this is the proven path that writes confirmation numbers and hands claims to
 * the read-only status checker.
 */
export async function reconcileInFlight(
  supabase: any,
  actorId: string | null,
  companyId?: string | null,
): Promise<{ checked: number; settled: number }> {
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
  // Reconcile every in-flight job in parallel: with many live jobs, sequential
  // polling delayed each freed slot by the sum of all the polls before it.
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
  return { checked: targets.length, settled: outcomes.filter(Boolean).length };
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
  actorId: string | null,
  companyId?: string | null,
  opts: { refill?: boolean; refillMaxRounds?: number } = {},
): Promise<{ checked: number; settled: number; started: string | null; startedIds: string[] }> {
  const { runSubmissionQueueTick } = await import("@/lib/submissionQueue.server");
  // Background sweeps keep refilling the freed single-flight slot in-tick, so a
  // finished claim is followed immediately by the next queued one.
  const tick = await runSubmissionQueueTick(supabase, {
    actorId,
    companyId,
    refill: opts.refill ?? false,
    // Bounded so one company can never monopolise a multi-tenant sweep.
    refillMaxRounds: opts.refill ? (opts.refillMaxRounds ?? 5) : 0,
  });
  return {
    checked: tick.checked,
    settled: tick.settled,
    started: tick.startedIds[0] ?? null,
    startedIds: tick.startedIds,
  };
}

