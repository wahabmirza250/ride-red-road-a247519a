/**
 * CORRECTED RESUBMISSION -> SUBMIT PATH (pure decisions, no I/O).
 *
 * A corrected resubmission is never a second submission path. It resolves to
 * the SAME billing record and goes through the SAME safe submit path as an
 * ordinary bill (preflight -> durable idempotent enqueue -> leased dispatch),
 * with one difference the payload builder already implements: when a trip has
 * a `queued` resubmission draft, the corrected snapshot overlays the payload,
 * so the robot is fed the corrected data and never the original denied fields.
 *
 * This module owns only the decisions:
 *   - which selected resubmissions may be handed to the submit path,
 *   - that an explicit owner confirmation exists (no confirmation -> no job),
 *   - that one resubmission can produce at most one submit intent,
 *   - that the ORIGINAL claim number is never accepted as the new claim.
 */

export type CorrectedSubmitRow = {
  id: string;
  status?: string | null;
  original_trip_id: string;
  original_claim_number?: string | null;
  idempotency_key?: string | null;
};

export type CorrectedSubmitSkip = {
  resubmission_id: string;
  code: "not_ready" | "no_billing_record" | "duplicate_selection";
  reason: string;
};

export type CorrectedSubmitPlan = {
  /** billing_record ids to hand to the shared submit path. */
  recordIds: string[];
  /** billing_record id -> resubmission id, for the audit trail. */
  pairs: Array<{ resubmission_id: string; billing_record_id: string; trip_id: string }>;
  skipped: CorrectedSubmitSkip[];
};

/**
 * Map selected resubmissions onto their billing records.
 * `records` is trip_id -> billing_record id.
 */
export function planCorrectedSubmit(
  rows: CorrectedSubmitRow[],
  records: Map<string, string>,
): CorrectedSubmitPlan {
  const plan: CorrectedSubmitPlan = { recordIds: [], pairs: [], skipped: [] };
  const seenResubmission = new Set<string>();
  const seenRecord = new Set<string>();

  for (const row of rows ?? []) {
    if (seenResubmission.has(row.id)) continue;
    seenResubmission.add(row.id);

    if (String(row.status ?? "") !== "queued") {
      plan.skipped.push({
        resubmission_id: row.id,
        code: "not_ready",
        reason: `This corrected claim is ${row.status ?? "unknown"} — only claims in Ready to Submit can be sent.`,
      });
      continue;
    }
    const recordId = records.get(row.original_trip_id);
    if (!recordId) {
      plan.skipped.push({
        resubmission_id: row.id,
        code: "no_billing_record",
        reason: "The billing record for the original claim no longer exists.",
      });
      continue;
    }
    if (seenRecord.has(recordId)) {
      // Two corrected drafts resolving to the same bill would be two claims for
      // one trip. Only the first is sent; the other is reported, never silently
      // dropped.
      plan.skipped.push({
        resubmission_id: row.id,
        code: "duplicate_selection",
        reason: "Another corrected claim for the same trip is already being sent.",
      });
      continue;
    }
    seenRecord.add(recordId);
    plan.recordIds.push(recordId);
    plan.pairs.push({
      resubmission_id: row.id,
      billing_record_id: recordId,
      trip_id: row.original_trip_id,
    });
  }
  return plan;
}

/** The original denied claim number can never become the new confirmation. */
export function isOriginalClaimReuse(
  newConfirmation: string | null | undefined,
  originalClaimNumber: string | null | undefined,
): boolean {
  const a = String(newConfirmation ?? "").trim();
  const b = String(originalClaimNumber ?? "").trim();
  return a !== "" && b !== "" && a === b;
}

/** No explicit owner confirmation => no job, ever. */
export function correctedSubmitAllowed(confirm: unknown): { ok: boolean; reason: string } {
  return confirm === true
    ? { ok: true, reason: "" }
    : {
        ok: false,
        reason: "Corrected claims are only sent after an explicit Auto Pilot confirmation.",
      };
}
