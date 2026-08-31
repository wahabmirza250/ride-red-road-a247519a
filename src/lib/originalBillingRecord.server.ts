/**
 * THE ORIGINAL BILLING RECORD (server-only).
 *
 * A trip has at most ONE original bill (`resubmission_id IS NULL`) plus at most
 * one corrected bill per resubmission. That model is enforced by two PARTIAL
 * unique indexes:
 *
 *   billing_records_trip_original_uniq  (trip_id) WHERE resubmission_id IS NULL
 *   billing_records_resubmission_uniq   (resubmission_id) WHERE resubmission_id IS NOT NULL
 *
 * PostgREST's `upsert(..., { onConflict: "trip_id" })` cannot target a PARTIAL
 * index — Postgres answers with
 *   "there is no unique or exclusion constraint matching the ON CONFLICT
 *    specification"
 * which is exactly what broke paper-bill upload. So instead of an upsert we do
 * an explicit, race-safe select -> insert -> (on unique violation) re-select.
 * The partial index remains the arbiter of correctness: a losing racer simply
 * reads the winner's row.
 */
type Sb = any;

export type EnsureOriginalArgs = {
  tripId: string;
  companyId?: string | null;
  tripFormId?: string | null;
  status?: string;
};

export type OriginalRecord = { id: string; created: boolean };

/** True when the DB refused an insert because the original row already exists. */
export function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? "");
}

/** The original bill for a trip, if there is one. */
export async function findOriginalBillingRecord(
  supabase: Sb,
  tripId: string,
): Promise<{ id: string; status?: string | null; state_confirmation_number?: string | null } | null> {
  const { data } = await supabase
    .from("billing_records")
    .select("id, status, state_confirmation_number")
    .eq("trip_id", tripId)
    .is("resubmission_id", null)
    .maybeSingle();
  return (data as any) ?? null;
}

/** A bill that already reached the portal must never be rewritten by an import. */
export function isImmutableOriginal(row: {
  status?: string | null;
  state_confirmation_number?: string | null;
} | null): boolean {
  if (!row) return false;
  if (row.state_confirmation_number) return true;
  return ["submitting", "submitted", "paid", "denied", "rejected"].includes(
    String(row.status ?? ""),
  );
}

/**
 * Get-or-create the ORIGINAL billing record for a trip. Idempotent and
 * race-safe; never creates or touches a corrected (resubmission) record.
 */
export async function ensureOriginalBillingRecord(
  supabase: Sb,
  args: EnsureOriginalArgs,
): Promise<OriginalRecord> {
  const existing = await findOriginalBillingRecord(supabase, args.tripId);
  if (existing) {
    if (!isImmutableOriginal(existing)) {
      const patch: Record<string, any> = {};
      if (args.companyId) patch["company_id"] = args.companyId;
      if (args.tripFormId) patch["trip_form_id"] = args.tripFormId;
      if (args.status) patch["status"] = args.status;
      if (Object.keys(patch).length) {
        await supabase
          .from("billing_records")
          .update(patch)
          .eq("id", existing.id)
          .is("resubmission_id", null);
      }
    }
    return { id: existing.id, created: false };
  }

  const { data, error } = await supabase
    .from("billing_records")
    .insert({
      trip_id: args.tripId,
      trip_form_id: args.tripFormId ?? args.tripId,
      company_id: args.companyId ?? null,
      status: args.status ?? "approved",
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    // Lost the race (or RLS/other failure) — the winner's row is authoritative.
    const raced = await findOriginalBillingRecord(supabase, args.tripId);
    if (raced) return { id: raced.id, created: false };
    throw new Error(
      `The billing record for this trip could not be created: ${error?.message ?? "unknown error"}`,
    );
  }
  return { id: data.id as string, created: true };
}
