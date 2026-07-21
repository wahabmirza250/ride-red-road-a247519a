import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateStateFormPdf, type Leg } from "@/lib/medicaidPdf";

/** Utility: verify admin, throw on failure */
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

const StatusEnum = z.enum([
  "pending_review",
  "pending_submit",
  "submitting",
  "submitted",
  "approved",
  "rejected",
  "needs_fix",
]);

const ALL_STATUSES = [
  "pending_review",
  "approved",
  "submitting",
  "needs_fix",
  "pending_submit",
  "submitted",
  "rejected",
] as const;

/* ---------- LIST ---------- */

export const listBillingRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        statuses: z.array(StatusEnum).min(1).optional(),
        status: StatusEnum.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const statuses = data.statuses ?? (data.status ? [data.status] : []);
    if (!statuses.length) throw new Error("statuses required");

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
      new Set(
        (rows ?? [])
          .map((r: any) => r.medicaid_trips?.driver_id)
          .filter(Boolean),
      ),
    );
    let profiles: Record<string, { first_name: string; last_name: string }> = {};
    if (driverIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", driverIds);
      profiles = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.id, p]),
      );
    }

    const pdfUrls = await Promise.all(
      (rows ?? []).map(async (r: any) => {
        const path: string | null = r.medicaid_trips?.state_pdf_path ?? null;
        if (!path) return null;
        const slash = path.lastIndexOf("/");
        const folder = slash >= 0 ? path.slice(0, slash) : "";
        const filename = slash >= 0 ? path.slice(slash + 1) : path;
        const { data: listed } = await supabase.storage
          .from("state-pdfs")
          .list(folder, { search: filename, limit: 1 });
        if (!listed?.some((f) => f.name === filename)) return null;
        const { data: signed } = await supabase.storage
          .from("state-pdfs")
          .createSignedUrl(path, 60 * 15);
        return signed?.signedUrl ?? null;
      }),
    );

    return (rows ?? []).map((r: any, i: number) => ({
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
      driver_name: profiles[r.medicaid_trips?.driver_id]
        ? `${profiles[r.medicaid_trips.driver_id].first_name ?? ""} ${profiles[r.medicaid_trips.driver_id].last_name ?? ""}`.trim()
        : "—",
      pickup_at: r.medicaid_trips?.pickup_at,
      pickup_address: r.medicaid_trips?.pickup_address,
      dropoff_address: r.medicaid_trips?.dropoff_address,
      pdf_url: pdfUrls[i],
      robot_job_id: r.medicaid_trips?.robot_job_id ?? null,
      robot_last_status: r.medicaid_trips?.robot_last_status ?? null,
      robot_last_message: r.medicaid_trips?.robot_last_message ?? null,
      robot_job_started_at: r.medicaid_trips?.robot_job_started_at ?? null,
    }));
  });

export const getBillingCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("billing_records")
      .select("status")
      .in("status", ALL_STATUSES as unknown as string[]);
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (const s of ALL_STATUSES) counts[s] = 0;
    for (const row of data ?? []) counts[(row as any).status] = (counts[(row as any).status] ?? 0) + 1;
    return counts;
  });


/* ---------- DETAIL ---------- */

export const getBillingRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `*, medicaid_trips(*, riders(full_name, medicaid_id, dob, last_4_ssn, phone, address), medicaid_trip_legs(*))`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const trip = rec.medicaid_trips as any;

    let driver_name = "—";
    if (trip?.driver_id) {
      const { data: p } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", trip.driver_id)
        .maybeSingle();
      if (p) driver_name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    }

    let signature_url: string | null = null;
    if (trip?.signature_path) {
      const { data: sig } = await supabase.storage
        .from("signatures")
        .createSignedUrl(trip.signature_path, 60 * 15);
      signature_url = sig?.signedUrl ?? null;
    }
    let pdf_url: string | null = null;
    if (trip?.state_pdf_path) {
      const { data: pdf } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(trip.state_pdf_path, 60 * 15);
      pdf_url = pdf?.signedUrl ?? null;
    }

    const { data: audit } = await supabase
      .from("billing_audit_log")
      .select("id, action, actor_type, notes, created_at")
      .eq("billing_record_id", data.id)
      .order("created_at", { ascending: false });

    return { record: rec, trip, driver_name, signature_url, pdf_url, audit: audit ?? [] };
  });

export const regenerateBillingPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `id, trip_id, medicaid_trips(*, riders(id, full_name, medicaid_id, dob, phone, address, last_4_ssn), medicaid_trip_legs(*))`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const trip = rec.medicaid_trips as any;
    if (!trip) throw new Error("Trip not found");
    if (!trip.signature_path) throw new Error("No saved passenger signature found for this trip");

    const { data: sig, error: sigErr } = await supabase.storage
      .from("signatures")
      .createSignedUrl(trip.signature_path, 60 * 15);
    if (sigErr) throw new Error(sigErr.message);
    if (!sig?.signedUrl) throw new Error("Could not load saved passenger signature");

    let driverName = "";
    if (trip.driver_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", trip.driver_id)
        .maybeSingle();
      driverName = profile
        ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.email || ""
        : "";
    }

    // If the rider was booked with SSN+DOB, decrypt the full SSN and write it
    // into the same "Member Health First Colorado ID #" field.
    let riderForPdf = trip.riders ?? null;
    if (riderForPdf?.id) {
      const raw = (riderForPdf.medicaid_id ?? "").trim();
      const isPlaceholder = raw.startsWith("SSN-") || raw.startsWith("WALK-");
      if (!raw || isPlaceholder) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ssn } = await supabaseAdmin.rpc("get_decrypted_rider_ssn", {
          _rider_id: riderForPdf.id,
        });
        if (ssn && typeof ssn === "string") {
          riderForPdf = { ...riderForPdf, medicaid_id: ssn };
        }
      }
    }

    const legs = normalizeTripLegs(trip);
    const pdfBytes = await generateStateFormPdf(
      {
        rider: riderForPdf,
        driverName,
        vehiclePlate: trip.vehicle_plate ?? null,
        vehicleVin: trip.vehicle_vin ?? null,
        vehicleType: trip.vehicle_type ?? null,
        escortName: trip.escort_name ?? null,
        identityVerified: trip.identity_verified !== false,
        tripKind: trip.trip_kind ?? "one_way",
        legs,
        signatureName: trip.signature_name ?? riderForPdf?.full_name ?? null,
        signatureUrl: sig.signedUrl,
        signedByEscort: trip.signed_by_escort ?? false,
      },
      { templateBaseUrl: getRequestOrigin() },
    );


    const pdfPath = trip.state_pdf_path || `${trip.driver_id}/${trip.id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("state-pdfs")
      .upload(pdfPath, new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), {
        upsert: true,
        contentType: "application/pdf",
      });
    if (uploadError) throw new Error(uploadError.message);

    const { error: updateError } = await supabase
      .from("medicaid_trips")
      .update({
        state_pdf_path: pdfPath,
        state_pdf_generated_at: new Date().toISOString(),
      })
      .eq("id", trip.id);
    if (updateError) throw new Error(updateError.message);

    await logAudit(supabase, data.id, userId, "regenerated_pdf", "PDF regenerated with saved passenger signature");

    const { data: pdf } = await supabase.storage
      .from("state-pdfs")
      .createSignedUrl(pdfPath, 60 * 15);

    return { ok: true, pdf_url: pdf?.signedUrl ?? null };
  });

/* ---------- REVIEW ACTIONS ---------- */

async function logAudit(
  supabase: any,
  billing_record_id: string,
  actor_id: string,
  action: string,
  notes?: string | null,
  actor_type: "admin" | "driver" | "system" = "admin",
) {
  await supabase.from("billing_audit_log").insert({
    billing_record_id,
    action,
    actor_id,
    actor_type,
    notes: notes ?? null,
  });
}

function getRequestOrigin(): string {
  const origin = getRequestHeader("origin");
  if (origin) return origin;
  const host = getRequestHeader("x-forwarded-host") ?? getRequestHeader("host");
  const proto = getRequestHeader("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:8080";
}

function normalizeTripLegs(trip: any): Leg[] {
  const rows = Array.isArray(trip.medicaid_trip_legs)
    ? [...trip.medicaid_trip_legs].sort((a, b) => Number(a.leg_index) - Number(b.leg_index))
    : [];

  if (rows.length) {
    return rows.map((l: any) => ({
      leg_index: (Number(l.leg_index) === 2 ? 2 : 1) as 1 | 2,
      leg_date: String(l.leg_date ?? "").slice(0, 10),
      pickup_time: l.pickup_time ? String(l.pickup_time).slice(0, 5) : null,
      pickup_odometer: Number(l.pickup_odometer ?? 0),
      pickup_address: l.pickup_address ?? "",
      dropoff_time: l.dropoff_time ? String(l.dropoff_time).slice(0, 5) : null,
      dropoff_odometer: Number(l.dropoff_odometer ?? 0),
      dropoff_address: l.dropoff_address ?? "",
    }));
  }

  const pickupAt = trip.pickup_at ? new Date(trip.pickup_at) : new Date();
  const date = Number.isNaN(pickupAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : pickupAt.toISOString().slice(0, 10);
  const time = Number.isNaN(pickupAt.getTime())
    ? null
    : pickupAt.toTimeString().slice(0, 5);

  return [
    {
      leg_index: 1 as const,
      leg_date: date,
      pickup_time: time,
      pickup_odometer: Number(trip.odometer_start ?? 0),
      pickup_address: trip.pickup_address ?? "",
      dropoff_time: null,
      dropoff_odometer: Number(trip.odometer_end ?? 0),
      dropoff_address: trip.dropoff_address ?? "",
    },
  ];
}

/**
 * Approve a trip after admin review. Moves it to `approved` status so it
 * shows up in the "Ready to Submit" tab. The robot is NOT triggered here;
 * the admin batches selected trips and clicks "Submit Claims" in Tab 2.
 */
export const approveBillingRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { error: updErr } = await supabase
      .from("billing_records")
      .update({
        status: "approved",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        fix_notes: null,
        submission_error: null,
        requires_human_step: false,
      })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);
    await logAudit(supabase, data.id, userId, "approved");
    return { ok: true };
  });

/**
 * Start (or retry) the Railway robot for a single billing record.
 * Called per-record from the "Ready to Submit" tab bulk-submit loop
 * or from the trip detail sheet.
 */
export const startRobotForRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error: recErr } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id,
         medicaid_trips!inner(
           id, pickup_at, odometer_start, odometer_end, signature_path,
           vehicle_type, trip_kind, rider_id,
           riders(medicaid_id)
         )`,
      )
      .eq("id", data.id)
      .single();
    if (recErr) throw new Error(recErr.message);
    if (!["approved", "needs_fix", "submitting"].includes(rec.status as string)) {
      throw new Error(`Trip is in "${rec.status}" and cannot be submitted from here`);
    }
    const trip: any = rec.medicaid_trips;
    if (!trip) throw new Error("Trip not found");

    try {
      await startRobotSubmission(supabase, {
        billingRecordId: data.id,
        trip,
        providerUserId: userId,
      });
      await logAudit(supabase, data.id, userId, "robot_started");
      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ?? "Failed to start automation";
      await supabase
        .from("billing_records")
        .update({ status: "needs_fix", submission_error: msg, fix_notes: msg })
        .eq("id", data.id);
      await logAudit(supabase, data.id, userId, "robot_start_failed", msg);
      throw new Error(msg);
    }
  });

/**
 * Record that a human logged into the portal, clicked Submit, and captured
 * the state's confirmation/receipt number. Moves the record to `submitted`.
 */
export const markPortalSubmitted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        confirmation_number: z.string().trim().min(1).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("billing_records")
      .update({
        status: "submitted",
        state_confirmation_number: data.confirmation_number,
        submitted_at: nowIso,
        submission_error: null,
        requires_human_step: false,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(
      supabase,
      data.id,
      userId,
      "portal_submitted",
      `Confirmation #${data.confirmation_number}`,
    );
    return { ok: true };
  });

const ROBOT_BASE_URL =
  "https://redart-hcpf-automation-production.up.railway.app";

function formatTripDateMDY(pickupAt: string | null | undefined): string {
  const d = pickupAt ? new Date(pickupAt) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const mm = String(safe.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(safe.getUTCDate()).padStart(2, "0");
  const yyyy = safe.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

async function startRobotSubmission(
  supabase: any,
  args: { billingRecordId: string; trip: any; providerUserId: string },
) {
  const { billingRecordId, trip, providerUserId } = args;
  const rider = trip.riders;
  const medicaidMemberId: string | null = rider?.medicaid_id ?? null;
  if (!medicaidMemberId) {
    throw new Error("Rider has no Medicaid member ID");
  }

  // Unique job id per submission attempt. Server-side timestamp keeps it
  // monotonic even if two attempts race.
  const jobId = `trip-${trip.id}-${Date.now()}`;

  const payload = {
    id: jobId,
    medicaid_trip_id: trip.id,
    provider_id: providerUserId,
    vehicle_type: (trip.vehicle_type as string | null) ?? "ambulatory",
    medicaid_member_id: medicaidMemberId,
    trip_date: formatTripDateMDY(trip.pickup_at),
    signature_captured: Boolean(trip.signature_path),
    pickup_odometer: Number(trip.odometer_start ?? 0),
    dropoff_odometer: Number(trip.odometer_end ?? 0),
    is_round_trip: trip.trip_kind === "round_trip",
  };

  const res = await fetch(`${ROBOT_BASE_URL}/submit-claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Automation service rejected the request (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* tolerate non-JSON */
  }
  const returnedJobId: string =
    typeof parsed?.jobId === "string" && parsed.jobId ? parsed.jobId : jobId;

  const nowIso = new Date().toISOString();
  await supabase
    .from("medicaid_trips")
    .update({
      robot_job_id: returnedJobId,
      robot_job_started_at: nowIso,
      robot_last_status: "started",
      robot_last_message: null,
      robot_last_checked_at: nowIso,
    })
    .eq("id", trip.id);

  await supabase
    .from("billing_records")
    .update({ status: "submitting", submission_error: null })
    .eq("id", billingRecordId);
}

/**
 * Poll the Railway automation service for job status and reconcile the
 * billing record. Safe to call repeatedly from the client — becomes a no-op
 * once the job is in a terminal state.
 */
export const checkRobotJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id,
         medicaid_trips!inner(id, robot_job_id, robot_last_status, robot_last_message, robot_last_checked_at)`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const trip: any = rec.medicaid_trips;
    const jobId: string | null = trip?.robot_job_id ?? null;
    if (!jobId) {
      return { pending: false, status: "no_job", message: "No robot job has been started for this trip." };
    }

    const res = await fetch(`${ROBOT_BASE_URL}/job-status/${encodeURIComponent(jobId)}`, {
      method: "GET",
    });
    const text = await res.text();
    if (!res.ok) {
      // Don't mutate DB state on a transient poll failure
      return {
        pending: true,
        status: "poll_error",
        message: `Poll failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    let body: any = {};
    try { body = JSON.parse(text); } catch { /* ignore */ }

    const jobStatus: string = String(body?.status ?? "unknown");
    const result = body?.result ?? {};
    const resultStatus: string = String(result?.status ?? "");
    const resultReason: string | null =
      typeof result?.reason === "string" && result.reason ? result.reason :
      typeof result?.message === "string" && result.message ? result.message :
      typeof body?.error === "string" && body.error ? body.error : null;

    const nowIso = new Date().toISOString();

    // Still running
    if (jobStatus !== "done" && jobStatus !== "error") {
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: jobStatus,
          robot_last_message: resultReason,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      return { pending: true, status: jobStatus, message: resultReason };
    }

    // Terminal: success path
    if (jobStatus === "done" && resultStatus === "READY_FOR_HUMAN_REVIEW") {
      const msg =
        "Claim form is filled in the HCPF portal — please log in, review, and click Submit manually.";
      await supabase
        .from("medicaid_trips")
        .update({
          robot_last_status: resultStatus,
          robot_last_message: msg,
          robot_last_checked_at: nowIso,
        })
        .eq("id", trip.id);
      await supabase
        .from("billing_records")
        .update({
          status: "pending_submit",
          requires_human_step: true,
          submission_error: msg,
        })
        .eq("id", rec.id);
      await logAudit(supabase, rec.id, userId, "robot_ready_for_review", msg);
      return { pending: false, status: resultStatus, message: msg };
    }

    // Terminal: error / BLOCKED_*
    const errMsg =
      resultReason ||
      (resultStatus ? `Automation returned ${resultStatus}` : "Automation failed");
    await supabase
      .from("medicaid_trips")
      .update({
        robot_last_status: resultStatus || jobStatus,
        robot_last_message: errMsg,
        robot_last_checked_at: nowIso,
      })
      .eq("id", trip.id);
    await supabase
      .from("billing_records")
      .update({
        status: "needs_fix",
        submission_error: errMsg,
        fix_notes: errMsg,
        requires_human_step: false,
      })
      .eq("id", rec.id);
    await logAudit(supabase, rec.id, userId, "robot_failed", errMsg);
    return { pending: false, status: resultStatus || jobStatus, message: errMsg };
  });


export const requestFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), notes: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error: recErr } = await supabase
      .from("billing_records")
      .select("id, trip_id, medicaid_trips(driver_id)")
      .eq("id", data.id)
      .single();
    if (recErr) throw new Error(recErr.message);

    const { error } = await supabase
      .from("billing_records")
      .update({
        status: "needs_fix",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        fix_notes: data.notes,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Also flip the trip back to needs_fix so it re-appears for the driver
    await supabase
      .from("medicaid_trips")
      .update({ status: "needs_fix", review_notes: data.notes })
      .eq("id", rec.trip_id);

    await logAudit(supabase, data.id, userId, "needs_fix", data.notes);

    // Send driver an in-app chat message via the dispatch (driver_admin) thread
    const driverRowId = (rec.medicaid_trips as any)?.driver_id as string | undefined;
    if (driverRowId) {
      const { data: driver } = await supabase
        .from("drivers")
        .select("user_id")
        .eq("id", driverRowId)
        .maybeSingle();
      const driverUserId = driver?.user_id;
      if (driverUserId) {
        // Find or create the driver_admin conversation
        let conversationId: string | null = null;
        const { data: existingConv } = await supabase
          .from("chat_conversations")
          .select("id")
          .eq("kind", "driver_admin")
          .eq("driver_user_id", driverUserId)
          .maybeSingle();
        if (existingConv?.id) {
          conversationId = existingConv.id;
        } else {
          const { data: createdConv, error: convErr } = await supabase
            .from("chat_conversations")
            .insert({
              kind: "driver_admin",
              driver_user_id: driverUserId,
              is_closed: false,
            })
            .select("id")
            .single();
          if (convErr) throw new Error(convErr.message);
          conversationId = createdConv.id;
        }

        if (conversationId) {
          const { error: msgErr } = await supabase.from("chat_messages").insert({
            conversation_id: conversationId,
            sender_id: userId,
            body: `Trip needs fix: ${data.notes}`,
          });
          if (msgErr) throw new Error(msgErr.message);
        }
      }
    }

    return { ok: true };
  });

export const markApproved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("billing_records")
      .update({ status: "approved" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, data.id, userId, "marked_approved");
    return { ok: true };
  });

export const markRejected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("billing_records")
      .update({ status: "rejected", rejection_reason: data.reason })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, data.id, userId, "marked_rejected", data.reason);
    return { ok: true };
  });




/* ---------- PORTAL CREDENTIALS ---------- */

export const listPortalCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("state_portal_credentials")
      .select(
        "id, portal_id, portal_name, state, login_email, password_last4, last_used_at, updated_at, company_id",
      )
      .order("portal_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertPortalCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        portal_id: z.string().min(1),
        portal_name: z.string().min(1),
        state: z.string().min(2),
        login_email: z.string().min(1),
        login_password: z.string().min(1),
        company_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: id, error } = await supabase.rpc("upsert_portal_credential", {
      _portal_id: data.portal_id,
      _portal_name: data.portal_name,
      _state: data.state,
      _login_email: data.login_email,
      _login_password: data.login_password,
      _company_id: (data.company_id ?? undefined) as string | undefined,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

/* ---------- BILLING SETTINGS ---------- */

export const getBillingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("billing_settings")
      .select("id, company_id, default_portal_id")
      .is("company_id", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      default_portal_id: data?.default_portal_id ?? null,
    };
  });


export const setDefaultBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ portal_id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.rpc("set_default_billing_portal", {
      _portal_id: data.portal_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
