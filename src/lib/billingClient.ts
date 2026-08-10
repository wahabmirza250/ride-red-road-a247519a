import { supabase } from "@/lib/supabaseBrowser";

/**
 * Browser-side fallbacks for the billing dashboard.
 *
 * The server functions occasionally fail at the edge on custom domains; admins
 * have full RLS access to these tables, so we can read the same data directly.
 */

export async function listBillingRecordsClient(statuses: string[]) {
  const { data: rows, error } = await supabase
    .from("billing_records")
    .select(
      `id, trip_id, status, reviewed_at, fix_notes, rejection_reason,
       submitted_at, state_confirmation_number, submission_error,
       requires_human_step, updated_at,
       medicaid_trips!inner(
         id, pickup_at, pickup_address, dropoff_address, driver_id, state_pdf_path,
         robot_job_id, robot_last_status, robot_last_message, robot_job_started_at,
         riders(full_name, medicaid_id)
       )`,
    )
    .in("status", statuses)
    .order("updated_at", { ascending: false });
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

  const pdfUrls = await Promise.all(
    (rows ?? []).map(async (r: any) => {
      const path: string | null = r.medicaid_trips?.state_pdf_path ?? null;
      if (!path) return null;
      const { data: signed } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(path, 60 * 15);
      return signed?.signedUrl ?? null;
    }),
  );

  return (rows ?? []).map((r: any, i: number) => {
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
      driver_name: prof ? `${prof.first_name ?? ""} ${prof.last_name ?? ""}`.trim() : "—",
      pickup_at: r.medicaid_trips?.pickup_at,
      pickup_address: r.medicaid_trips?.pickup_address,
      dropoff_address: r.medicaid_trips?.dropoff_address,
      pdf_url: pdfUrls[i],
      robot_job_id: r.medicaid_trips?.robot_job_id ?? null,
      robot_last_status: r.medicaid_trips?.robot_last_status ?? null,
      robot_last_message: r.medicaid_trips?.robot_last_message ?? null,
      robot_job_started_at: r.medicaid_trips?.robot_job_started_at ?? null,
    };
  });
}

export async function getBillingCountsClient() {
  const { data, error } = await supabase.from("billing_records").select("status");
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const s = (row as any).status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
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
