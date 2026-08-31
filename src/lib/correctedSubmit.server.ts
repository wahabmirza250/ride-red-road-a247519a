/**
 * SEND CORRECTED RESUBMISSIONS (server-only).
 *
 * Runs ONLY on an explicit owner action (Auto Pilot confirmation with the
 * selected corrected candidates). It resolves each corrected resubmission to
 * its billing record and hands it to the ONE shared submit path, so preflight,
 * idempotency, per-account/per-rider pacing and uncertain-outcome guards are
 * identical to an ordinary bill.
 *
 * The corrected DATA reaches the robot through the existing payload overlay:
 * `startRobotSubmission` reads the `queued` draft for the trip and replaces the
 * payload fields with the saved snapshot. Original trip rows, the original
 * claim number and the denial history are never written here.
 */
import { planCorrectedSubmit, correctedSubmitAllowed } from "@/lib/correctedSubmit";

type Sb = any;

export type CorrectedSubmitResult = {
  requested: number;
  queued: number;
  started: number;
  skipped: Array<{ id: string; reason: string; code: string }>;
};

export async function submitCorrectedResubmissions(
  supabase: Sb,
  userId: string,
  args: { resubmissionIds: string[]; confirm: boolean; companyId?: string | null },
): Promise<CorrectedSubmitResult> {
  const gate = correctedSubmitAllowed(args.confirm);
  if (!gate.ok) throw new Error(gate.reason);

  const ids = [...new Set((args.resubmissionIds ?? []).filter(Boolean))];
  if (!ids.length) return { requested: 0, queued: 0, started: 0, skipped: [] };

  let q = supabase
    .from("claim_resubmissions")
    .select("id, company_id, status, original_trip_id, original_claim_number, idempotency_key")
    .in("id", ids);
  if (args.companyId) q = q.eq("company_id", args.companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const tripIds = [...new Set(((rows ?? []) as any[]).map((r) => r.original_trip_id))];
  const { data: recs } = tripIds.length
    ? await supabase.from("billing_records").select("id, trip_id").in("trip_id", tripIds)
    : { data: [] as any[] };
  const recordOf = new Map(((recs ?? []) as any[]).map((r) => [r.trip_id, r.id as string]));

  const plan = planCorrectedSubmit((rows ?? []) as any[], recordOf);
  const skipped = plan.skipped.map((s) => ({
    id: s.resubmission_id,
    reason: s.reason,
    code: s.code as string,
  }));
  if (!plan.recordIds.length) return { requested: ids.length, queued: 0, started: 0, skipped };

  const { submitSelectedRecords } = await import("@/lib/submitSelection.server");
  const res = await submitSelectedRecords(supabase, userId, {
    ids: plan.recordIds,
    // The original claim IS denied and carries a claim number; sending the
    // corrected version is a deliberate, acknowledged new attempt.
    acknowledgeDuplicate: true,
    label: `Corrected resubmission (${plan.recordIds.length})`,
  });

  const recordToResubmission = new Map(
    plan.pairs.map((p) => [p.billing_record_id, p.resubmission_id]),
  );
  for (const s of res.skipped) {
    const rid = recordToResubmission.get(s.id);
    if (rid) skipped.push({ id: rid, reason: s.reason, code: s.code as string });
  }

  // Resubmission-specific audit: one event per corrected claim actually queued.
  const skippedRecordIds = new Set(res.skipped.map((s) => s.id));
  const queuedPairs = plan.pairs.filter((p) => !skippedRecordIds.has(p.billing_record_id));
  if (queuedPairs.length) {
    const byId = new Map(((rows ?? []) as any[]).map((r) => [r.id, r]));
    await supabase.from("claim_resubmission_events").insert(
      queuedPairs.map((p) => ({
        resubmission_id: p.resubmission_id,
        company_id: byId.get(p.resubmission_id)?.company_id ?? args.companyId ?? null,
        actor_id: userId,
        action: "resubmission_submitted",
        changes: [],
        notes:
          `Owner started Auto Pilot for this corrected claim. Sent with key ` +
          `${byId.get(p.resubmission_id)?.idempotency_key ?? "n/a"}. Original claim ` +
          `${byId.get(p.resubmission_id)?.original_claim_number ?? "n/a"} is untouched and is never reused.`,
      })),
    );
  }

  return {
    requested: ids.length,
    queued: res.queued,
    started: res.started,
    skipped,
  };
}
