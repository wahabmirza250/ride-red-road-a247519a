import { supabase } from "@/lib/supabaseBrowser";

/**
 * Browser-side fallbacks for the billing dashboard.
 *
 * The server functions occasionally fail at the edge on custom domains; admins
 * have full RLS access to these tables, so we can read the same data directly.
 */

export async function listBillingRecordsClient(
  statuses: string[],
  opts: { limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const { data: rows, error } = await supabase
    .from("billing_records")
    .select(
      `id, trip_id, status, reviewed_at, fix_notes, rejection_reason,
       submitted_at, state_confirmation_number, submission_error,
       requires_human_step, updated_at,
       medicaid_trips!inner(
         id, pickup_at, pickup_address, dropoff_address, driver_id, paper_driver_name, state_pdf_path,
         robot_job_id, robot_last_status, robot_last_message, robot_job_started_at,
         riders(full_name, medicaid_id)
       )`,
    )
    .in("status", statuses)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const driverIds = Array.from(
    new Set((rows ?? []).map((r: any) => r.medicaid_trips?.driver_id).filter(Boolean)),
  );
  let profiles: Record<string, any> = {};
  if (driverIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", driverIds as string[]);
    profiles = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p]));
  }

  // PERF: no per-row signed URLs — the form is signed lazily on open.
  return (rows ?? []).map((r: any) => {
    const prof = profiles[r.medicaid_trips?.driver_id];
    return {
      id: r.id,
      trip_id: r.trip_id,
      status: r.status,
      reviewed_at: r.reviewed_at,
      fix_notes: r.fix_notes,
      rejection_reason: r.rejection_reason,
      submitted_at: r.submitted_at,
      state_confirmation_number: r.state_confirmation_number,
      submission_error: r.submission_error,
      requires_human_step: r.requires_human_step,
      updated_at: r.updated_at,
      passenger_name: r.medicaid_trips?.riders?.full_name ?? null,
      medicaid_id: r.medicaid_trips?.riders?.medicaid_id ?? null,
      // Paper bills carry the driver written on the form; that always wins over
      // the staff account that keyed the bill in.
      driver_name:
        (r.medicaid_trips?.paper_driver_name?.trim() || null) ??
        (prof ? `${prof.first_name ?? ""} ${prof.last_name ?? ""}`.trim() : "—"),
      pickup_at: r.medicaid_trips?.pickup_at,
      pickup_address: r.medicaid_trips?.pickup_address,
      dropoff_address: r.medicaid_trips?.dropoff_address,
      has_pdf: !!r.medicaid_trips?.state_pdf_path,
      pdf_url: null as string | null,
      robot_job_id: r.medicaid_trips?.robot_job_id ?? null,
      robot_last_status: r.medicaid_trips?.robot_last_status ?? null,
      robot_last_message: r.medicaid_trips?.robot_last_message ?? null,
      robot_job_started_at: r.medicaid_trips?.robot_job_started_at ?? null,
    };
  });
}

const COUNT_STATUSES = [
  "pending_review",
  "approved",
  "queued",
  "submitting",
  "pending_submit",
  "submitted",
  "needs_fix",
  "rejected",
];

export async function getBillingCountsClient() {
  // PERF: head counts only — no rows transferred.
  const counts: Record<string, number> = {};
  await Promise.all(
    COUNT_STATUSES.map(async (s) => {
      const { count, error } = await supabase
        .from("billing_records")
        .select("id", { count: "exact", head: true })
        .eq("status", s as never);
      if (error) throw new Error(error.message);
      counts[s] = count ?? 0;
    }),
  );
  return counts;
}

/**
 * Browser-side fallback for cancelling a submission when the server function
 * fails at the edge. Mirrors the server checks: a claim that already carries a
 * real portal confirmation number can never be cancelled here.
 */
export async function cancelSubmissionClient(id: string) {
  const { data: rec, error } = await supabase
    .from("billing_records")
    .select(
      `id, status, trip_id, state_confirmation_number,
       medicaid_trips!inner(id, robot_confirmation_number, submitted_confirmation, portal_confirmation)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rec) throw new Error("This billing record could not be found.");

  const trip: any = (rec as any).medicaid_trips;
  const alreadySubmitted =
    (rec as any).status === "submitted" ||
    !!(rec as any).state_confirmation_number ||
    !!trip?.robot_confirmation_number ||
    !!trip?.submitted_confirmation ||
    !!trip?.portal_confirmation;
  if (alreadySubmitted) {
    throw new Error(
      "This claim has already been submitted to Medicaid" +
        (trip?.robot_confirmation_number ? ` (claim #${trip.robot_confirmation_number})` : "") +
        ". Void or adjust it in the state portal instead.",
    );
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("medicaid_trips")
    .update({
      robot_job_id: null,
      robot_pass: null,
      robot_last_status: "cancelled",
      robot_last_message: "Submission cancelled by billing staff before the real submit.",
      robot_last_checked_at: nowIso,
      robot_captured_claim: null,
      robot_captured_at: null,
    })
    .eq("id", (rec as any).trip_id);

  const { error: updErr } = await supabase
    .from("billing_records")
    .update({ status: "approved", requires_human_step: false, submission_error: null })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  return { ok: true };
}

/** Browser-side fallback for deleting billing records (same safety rules). */
export async function deleteBillingRecordsClient(ids: string[]) {
  const { data: recs, error } = await supabase
    .from("billing_records")
    .select("id, status, trip_id, state_confirmation_number")
    .in("id", ids);
  if (error) throw new Error(error.message);
  if (!recs?.length) {
    const { PERMISSION_MESSAGE } = await import("@/lib/deleteBills");
    throw new Error(PERMISSION_MESSAGE);
  }

  const { performBillDelete } = await import("@/lib/deleteBills");
  return await performBillDelete(supabase, recs as any);
}

