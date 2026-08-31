/**
 * THE CORRECTED SUBMISSION RECORD (server-only).
 *
 * A corrected resubmission must NEVER reuse the original denied billing
 * record. The original is immutable evidence: it holds the real HCPF claim
 * number, the denied status, the denial reason, the amounts and the audit
 * history, and the database guard `guard_confirmed_claim_resubmit` rightly
 * refuses to put a record that already owns a claim number back into the
 * queue. That guard is exactly why every corrected claim of the 2026-08-31
 * batch failed with "Could not be queued — please try again."
 *
 * So a corrected claim gets its OWN billing record:
 *   - same trip, no claim number, fresh submission state;
 *   - `resubmission_id` links it 1:1 to the corrected draft;
 *   - a partial unique index on `resubmission_id` makes creation idempotent,
 *     so two clicks / two tabs can only ever produce ONE corrected record.
 */
type Sb = any;

export type CorrectedRecord = { id: string; created: boolean };

/** Fetch the corrected record for a resubmission, if it already exists. */
export async function findCorrectedRecord(
  supabase: Sb,
  resubmissionId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("billing_records")
    .select("id")
    .eq("resubmission_id", resubmissionId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/**
 * Get-or-create the corrected record. Idempotent: a unique-violation from a
 * concurrent click is resolved by reading the winner's row.
 */
export async function ensureCorrectedBillingRecord(
  supabase: Sb,
  args: { resubmissionId: string; tripId: string; companyId?: string | null },
): Promise<CorrectedRecord> {
  const existing = await findCorrectedRecord(supabase, args.resubmissionId);
  if (existing) return { id: existing, created: false };

  // Copy only the identity fields. Never the claim number, never the denied
  // status, never the denial reason — those belong to the original alone.
  const { data: original } = await supabase
    .from("billing_records")
    .select("trip_id, trip_form_id, company_id")
    .eq("trip_id", args.tripId)
    .is("resubmission_id", null)
    .maybeSingle();

  const { data, error } = await supabase
    .from("billing_records")
    .insert({
      trip_id: args.tripId,
      trip_form_id: original?.trip_form_id ?? null,
      company_id: args.companyId ?? original?.company_id ?? null,
      resubmission_id: args.resubmissionId,
      status: "pending_submit",
      requires_human_step: false,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    const raced = await findCorrectedRecord(supabase, args.resubmissionId);
    if (raced) return { id: raced, created: false };
    throw new Error(
      `The corrected submission record could not be created: ${error.message ?? "unknown error"}`,
    );
  }
  if (!data?.id) {
    const raced = await findCorrectedRecord(supabase, args.resubmissionId);
    if (raced) return { id: raced, created: false };
    throw new Error("The corrected submission record could not be created.");
  }
  return { id: data.id as string, created: true };
}
