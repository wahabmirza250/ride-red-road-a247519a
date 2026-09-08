/**
 * IS THIS BILL REALLY BEING WORKED RIGHT NOW? (pure — safe on the client)
 *
 * "Processing" must mean a robot is holding this bill at this moment. It must
 * NEVER be inferred from history: `robot_last_status = 'SUBMITTED'`, a
 * `processing` corrected row or a stale `submitting` status can survive for
 * days after the worker that owned them died, and a bill parked in a fake
 * Processing lane is a bill nobody ever looks at.
 *
 * The only proof of life is a LIVE, UNEXPIRED lease (or a very recent
 * heartbeat). The moment the lease expires the bill leaves Processing and is
 * shown for what it is — a Verification Hold, because an interrupted run may
 * or may not have reached HCPF.
 */

/** A heartbeat older than this no longer proves a worker is alive. */
export const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

export type LiveJobInput = {
  status?: string | null;
  submit_locked_until?: string | null;
  submit_heartbeat_at?: string | null;
  submit_lease_started_at?: string | null;
  submit_worker?: string | null;
};

function ms(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** A lease that has not expired, or a heartbeat inside the freshness window. */
export function hasLiveSubmissionLease(rec: LiveJobInput, now: number = Date.now()): boolean {
  const until = ms(rec.submit_locked_until ?? null);
  if (until !== null && until > now) return true;
  const beat = ms(rec.submit_heartbeat_at ?? null);
  return beat !== null && now - beat < HEARTBEAT_FRESH_MS;
}

/**
 * Belongs in the Processing lane?
 *  - `queued` / `pending_submit` genuinely wait their turn — that is Processing.
 *  - `submitting` counts ONLY while the lease is live; an expired lease is a
 *    lost job, never Processing.
 */
export function isActivelyProcessing(rec: LiveJobInput, now: number = Date.now()): boolean {
  const status = String(rec.status ?? "");
  if (status === "queued" || status === "pending_submit") return true;
  if (status === "submitting") return hasLiveSubmissionLease(rec, now);
  return false;
}

export type CorrectedStageInput = {
  /** `claim_resubmissions.status` */
  resubmission_status?: string | null;
  /** Lease fields of the billing record the corrected copy was handed to. */
  record?: LiveJobInput | null;
};

export const CORRECTED_HOLD_REASON =
  "The robot run for this corrected claim ended without a result and no worker is holding it now. " +
  "It may or may not have reached HCPF, so it waits for a read-only portal check — nothing was resubmitted.";

/**
 * Where a corrected copy should be SHOWN. A `processing` row without a live
 * lease is a Verification Hold, not work in progress.
 */
export function correctedDisplayStage(
  input: CorrectedStageInput,
  now: number = Date.now(),
): "processing" | "verification_hold" | "other" {
  if (String(input.resubmission_status ?? "") !== "processing") return "other";
  const rec = input.record ?? null;
  if (rec && hasLiveSubmissionLease(rec, now)) return "processing";
  return "verification_hold";
}

/** Split corrected `processing` rows into the live and the held bucket. */
export function splitCorrectedProcessing<
  T extends { id: string; submission_billing_record_id?: string | null },
>(
  rows: T[],
  leases: Map<string, LiveJobInput>,
  now: number = Date.now(),
): { processing: T[]; verification_hold: T[] } {
  const processing: T[] = [];
  const verification_hold: T[] = [];
  for (const r of rows) {
    const rec = r.submission_billing_record_id
      ? (leases.get(r.submission_billing_record_id) ?? null)
      : null;
    const stage = correctedDisplayStage({ resubmission_status: "processing", record: rec }, now);
    (stage === "processing" ? processing : verification_hold).push(r);
  }
  return { processing, verification_hold };
}
