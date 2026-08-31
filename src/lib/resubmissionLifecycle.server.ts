/**
 * CORRECTED RESUBMISSION STATE MACHINE — I/O side (server-only).
 *
 * Everything here is a single-row, condition-checked UPDATE. A transition can
 * only ever happen once: the WHERE clause carries the expected current status
 * (and the expected idempotency key when we have one), so a double click or a
 * second browser claims ZERO rows and creates ZERO duplicate jobs.
 */
import {
  classifyResubmissionOutcome,
  classifyPortalFinancialStatus,
  isOriginalClaimReuse,
  type RobotOutcome,
} from "@/lib/resubmissionLifecycle";

type Sb = any;

export type ClaimRow = {
  id: string;
  company_id?: string | null;
  status?: string | null;
  idempotency_key?: string | null;
  original_claim_number?: string | null;
  original_trip_id?: string;
};

export type ClaimAttempt = {
  claimed: string[];
  /** Rows another click/session already took, or whose audit write failed. */
  rejected: Array<{ id: string; reason: string }>;
};

/** Audit insert that never fails silently. */
export async function writeResubmissionEvent(
  supabase: Sb,
  event: {
    resubmission_id: string;
    company_id?: string | null;
    actor_id?: string | null;
    action: string;
    notes: string;
  },
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.from("claim_resubmission_events").insert({
    resubmission_id: event.resubmission_id,
    company_id: event.company_id ?? null,
    actor_id: event.actor_id ?? null,
    action: event.action,
    changes: [],
    notes: event.notes,
  });
  return { ok: !error, error: error?.message ?? null };
}

/**
 * ATOMIC LEASE: queued -> processing, one row at a time.
 * Only rows returned in `claimed` may be handed to the shared submit path.
 */
export async function claimResubmissionsForSubmit(
  supabase: Sb,
  userId: string,
  rows: ClaimRow[],
  recordOf?: Map<string, string>,
): Promise<ClaimAttempt> {
  const out: ClaimAttempt = { claimed: [], rejected: [] };
  const nowIso = new Date().toISOString();

  for (const row of rows ?? []) {
    let q = supabase
      .from("claim_resubmissions")
      .update({
        status: "processing",
        claimed_at: nowIso,
        claimed_by: userId,
        failure_reason: null,
        ...(recordOf && row.original_trip_id && recordOf.get(row.original_trip_id)
          ? { submission_billing_record_id: recordOf.get(row.original_trip_id) }
          : {}),
      })
      .eq("id", row.id)
      .eq("status", "queued");
    if (row.idempotency_key) q = q.eq("idempotency_key", row.idempotency_key);
    const { data, error } = await q.select("id");

    if (error) {
      out.rejected.push({ id: row.id, reason: error.message });
      continue;
    }
    if (!data || data.length === 0) {
      out.rejected.push({
        id: row.id,
        reason: "This corrected claim was already taken by another submission run.",
      });
      continue;
    }

    const audit = await writeResubmissionEvent(supabase, {
      resubmission_id: row.id,
      company_id: row.company_id ?? null,
      actor_id: userId,
      action: "resubmission_claimed",
      notes:
        "Owner started Auto Pilot for this corrected claim. It left Ready to Submit and is " +
        `now processing (key ${row.idempotency_key ?? "n/a"}). Original claim ` +
        `${row.original_claim_number ?? "n/a"} is untouched and is never reused.`,
    });
    if (!audit.ok) {
      // The audit trail is part of the guarantee: without it we do NOT submit.
      await releaseResubmissionToReady(
        supabase,
        row.id,
        "The audit trail could not be written, so nothing was sent.",
      );
      out.rejected.push({
        id: row.id,
        reason: `Audit trail could not be written (${audit.error}). Nothing was sent.`,
      });
      continue;
    }
    out.claimed.push(row.id);
  }
  return out;
}

/** processing -> queued. Only when it is PROVEN that no job was created. */
export async function releaseResubmissionToReady(
  supabase: Sb,
  id: string,
  reason: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("claim_resubmissions")
    .update({ status: "queued", claimed_at: null, claimed_by: null, failure_reason: reason })
    .eq("id", id)
    .eq("status", "processing")
    .select("id");
  return Boolean(data && data.length);
}

/** processing -> failed. Definitive "nothing was sent", needs an owner decision. */
export async function markResubmissionFailed(
  supabase: Sb,
  id: string,
  reason: string,
  actorId?: string | null,
): Promise<boolean> {
  const { data } = await supabase
    .from("claim_resubmissions")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", id)
    .eq("status", "processing")
    .select("id, company_id");
  if (!data || !data.length) return false;
  await writeResubmissionEvent(supabase, {
    resubmission_id: id,
    company_id: data[0].company_id ?? null,
    actor_id: actorId ?? null,
    action: "resubmission_failed",
    notes: reason,
  });
  return true;
}

/**
 * SHARED ROBOT RESULT -> corrected resubmission.
 *
 * The linkage is the explicit `submission_billing_record_id` written when the
 * row was claimed (never a guess from the trip's history).
 */
export async function reconcileResubmissionForRecord(
  supabase: Sb,
  args: { recordId: string; actorId?: string | null; outcome: RobotOutcome },
): Promise<{ changed: false } | { changed: true; next: "submitted" | "failed"; id: string }> {
  const { data: rows } = await supabase
    .from("claim_resubmissions")
    .select("id, company_id, original_claim_number, status")
    .eq("submission_billing_record_id", args.recordId)
    .eq("status", "processing")
    .limit(1);
  const row = (rows ?? [])[0];
  if (!row) return { changed: false };

  const decision = classifyResubmissionOutcome(args.outcome, row.original_claim_number);
  if (!decision.next) return { changed: false };

  if (decision.next === "failed") {
    const ok = await markResubmissionFailed(supabase, row.id, decision.reason, args.actorId);
    return ok ? { changed: true, next: "failed", id: row.id } : { changed: false };
  }

  const claim = decision.claimNumber;
  if (!claim || isOriginalClaimReuse(claim, row.original_claim_number)) return { changed: false };

  const { data: updated } = await supabase
    .from("claim_resubmissions")
    .update({
      status: "submitted",
      resubmission_claim_number: claim,
      submitted_at: new Date().toISOString(),
      submitted_by: args.actorId ?? null,
      failure_reason: null,
    })
    .eq("id", row.id)
    .eq("status", "processing")
    .select("id");
  if (!updated || !updated.length) return { changed: false };

  await writeResubmissionEvent(supabase, {
    resubmission_id: row.id,
    company_id: row.company_id ?? null,
    actor_id: args.actorId ?? null,
    action: "resubmission_confirmed",
    notes: decision.reason,
  });
  return { changed: true, next: "submitted", id: row.id };
}

/** Later portal truth on the NEW claim: submitted -> paid / denied. */
export async function reconcileResubmissionFinancialStatus(
  supabase: Sb,
  args: { recordId: string; portalStatus: string | null | undefined; actorId?: string | null },
): Promise<{ changed: boolean }> {
  const { data: rows } = await supabase
    .from("claim_resubmissions")
    .select("id, company_id, status, resubmission_claim_number")
    .eq("submission_billing_record_id", args.recordId)
    .eq("status", "submitted")
    .limit(1);
  const row = (rows ?? [])[0];
  if (!row) return { changed: false };

  const next = classifyPortalFinancialStatus(row.status, args.portalStatus);
  if (!next) return { changed: false };

  const { data: updated } = await supabase
    .from("claim_resubmissions")
    .update({ status: next })
    .eq("id", row.id)
    .eq("status", "submitted")
    .select("id");
  if (!updated || !updated.length) return { changed: false };

  await writeResubmissionEvent(supabase, {
    resubmission_id: row.id,
    company_id: row.company_id ?? null,
    actor_id: args.actorId ?? null,
    action: `resubmission_${next}`,
    notes: `The portal reported the corrected claim ${row.resubmission_claim_number ?? ""} as ${next}.`.trim(),
  });
  return { changed: true };
}
