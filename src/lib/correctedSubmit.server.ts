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
  /** True when a claim was sent but its audit event could not be written. */
  audit_failed: boolean;
};

export async function submitCorrectedResubmissions(
  supabase: Sb,
  userId: string,
  args: { resubmissionIds: string[]; confirm: boolean; companyId?: string | null },
): Promise<CorrectedSubmitResult> {
  const gate = correctedSubmitAllowed(args.confirm);
  if (!gate.ok) throw new Error(gate.reason);

  const ids = [...new Set((args.resubmissionIds ?? []).filter(Boolean))];
  if (!ids.length)
    return { requested: 0, queued: 0, started: 0, skipped: [], audit_failed: false };

  let q = supabase
    .from("claim_resubmissions")
    .select(
      "id, company_id, status, original_trip_id, original_claim_number, idempotency_key, draft_snapshot",
    )
    .in("id", ids);
  if (args.companyId) q = q.eq("company_id", args.companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  // EVERY corrected claim gets its OWN submission record. The original denied
  // record keeps its claim number, its denied status and its history; it is
  // never read for status, never re-queued and never written here.
  const { ensureCorrectedBillingRecord } = await import("@/lib/correctedRecord.server");
  const recordOf = new Map<string, string>();
  const prepFailed: Array<{ id: string; reason: string }> = [];
  for (const row of ((rows ?? []) as any[]).filter((r) => String(r.status ?? "") === "queued")) {
    try {
      const rec = await ensureCorrectedBillingRecord(supabase, {
        resubmissionId: row.id,
        tripId: row.original_trip_id,
        companyId: row.company_id ?? args.companyId ?? null,
      });
      recordOf.set(row.id, rec.id);
    } catch (e: any) {
      prepFailed.push({ id: row.id, reason: String(e?.message ?? e) });
    }
  }

  const plan = planCorrectedSubmit((rows ?? []) as any[], recordOf);
  const skipped = plan.skipped.map((s) => ({
    id: s.resubmission_id,
    reason: s.reason,
    code: s.code as string,
  }));
  for (const f of prepFailed) skipped.push({ id: f.id, reason: f.reason, code: "no_billing_record" });
  if (!plan.recordIds.length) return { requested: ids.length, queued: 0, started: 0, skipped, audit_failed: false };


  // ATOMIC CLAIM BEFORE ANY JOB EXISTS.
  // queued -> processing, one conditional UPDATE per row (expected status AND
  // expected idempotency key). A double click or a second browser claims zero
  // rows, so it can never create a second job for the same corrected claim.
  const byId = new Map(((rows ?? []) as any[]).map((r) => [r.id, r]));
  const { claimResubmissionsForSubmit, releaseResubmissionToReady, writeResubmissionEvent } =
    await import("@/lib/resubmissionLifecycle.server");
  const claim = await claimResubmissionsForSubmit(
    supabase,
    userId,
    plan.pairs.map((p) => byId.get(p.resubmission_id)).filter(Boolean) as any[],
    recordOf,
  );
  for (const r of claim.rejected) skipped.push({ id: r.id, reason: r.reason, code: "not_ready" });

  const claimedSet = new Set(claim.claimed);
  const claimedPairs = plan.pairs.filter((p) => claimedSet.has(p.resubmission_id));
  if (!claimedPairs.length) {
    return { requested: ids.length, queued: 0, started: 0, skipped, audit_failed: false };
  }

  // The mileage gate must judge the CORRECTED legs/lines, each on its own —
  // never a first-pickup-to-last-dropoff span across a same-day gap.
  const correctedCtx = new Map<string, any>();
  for (const p of claimedPairs) {
    const snap = (byId.get(p.resubmission_id) as any)?.draft_snapshot ?? {};
    correctedCtx.set(p.billing_record_id, {
      resubmissionId: p.resubmission_id,
      legs: Array.isArray(snap?.legs) ? snap.legs : [],
      lines: Array.isArray(snap?.lines) ? snap.lines : [],
      serviceDate: snap?.service_date ?? null,
    });
  }

  const { submitSelectedRecords } = await import("@/lib/submitSelection.server");
  let res: any;
  try {
    res = await submitSelectedRecords(supabase, userId, {
      ids: claimedPairs.map((p) => p.billing_record_id),
      // The original claim IS denied and carries a claim number; sending the
      // corrected version is a deliberate, acknowledged new attempt.
      acknowledgeDuplicate: true,
      label: `Corrected resubmission (${claimedPairs.length})`,
      corrected: correctedCtx,
    });

  } catch (e: any) {
    // We cannot PROVE no job was created, so the rows stay in `processing`
    // (out of Ready, never auto-retried) and are resolved by verification.
    for (const p of claimedPairs) {
      await writeResubmissionEvent(supabase, {
        resubmission_id: p.resubmission_id,
        company_id: byId.get(p.resubmission_id)?.company_id ?? args.companyId ?? null,
        actor_id: userId,
        action: "resubmission_submit_error",
        notes:
          `The submission run failed with: ${String(e?.message ?? e)}. The outcome is not ` +
          `certain, so this corrected claim stays in Processing until it is verified.`,
      });
    }
    throw e;
  }

  const recordToResubmission = new Map(
    claimedPairs.map((p) => [p.billing_record_id, p.resubmission_id]),
  );

  // PROVEN "no job created": skipped + preflight-failed records go back to
  // Ready with the attempt recorded, never left stuck in Processing.
  const notSent = [
    ...res.skipped.map((s: any) => ({ id: s.id, reason: s.reason, code: s.code as string })),
    ...(res.failed ?? []).map((f: any) => ({ id: f.id, reason: f.reason, code: "not_ready" })),
  ];
  const releasedRecordIds = new Set<string>();
  for (const s of notSent) {
    const rid = recordToResubmission.get(s.id);
    if (!rid || releasedRecordIds.has(s.id)) continue;
    releasedRecordIds.add(s.id);
    await releaseResubmissionToReady(supabase, rid, s.reason);
    await writeResubmissionEvent(supabase, {
      resubmission_id: rid,
      company_id: byId.get(rid)?.company_id ?? args.companyId ?? null,
      actor_id: userId,
      action: "resubmission_returned_to_ready",
      notes: `Nothing was sent (${s.reason}). The corrected claim is back in Ready to Submit.`,
    });
    skipped.push({ id: rid, reason: s.reason, code: s.code as any });
  }

  // Resubmission-specific audit: one event per corrected claim actually sent.
  const sentPairs = claimedPairs.filter((p) => !releasedRecordIds.has(p.billing_record_id));
  let auditFailed = false;
  for (const p of sentPairs) {
    const row = byId.get(p.resubmission_id);
    const audit = await writeResubmissionEvent(supabase, {
      resubmission_id: p.resubmission_id,
      company_id: row?.company_id ?? args.companyId ?? null,
      actor_id: userId,
      action: "resubmission_submitted",
      notes:
        `Owner started Auto Pilot for this corrected claim. Sent with key ` +
        `${row?.idempotency_key ?? "n/a"}. Original claim ` +
        `${row?.original_claim_number ?? "n/a"} is untouched and is never reused.`,
    });
    if (!audit.ok) auditFailed = true;
  }

  return {
    requested: ids.length,
    queued: res.queued,
    started: res.started,
    skipped,
    audit_failed: auditFailed,
  };
}
