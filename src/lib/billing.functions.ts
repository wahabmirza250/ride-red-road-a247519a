import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  assertAdmin,
  assertBilling,
  StatusEnum,
  ALL_STATUSES,
  logAudit,
  getRequestOrigin,
  normalizeTripLegs,
  ROBOT_BASE_URL,
  

  looksLikePostConfirmTimeout,
  UNVERIFIED_SUBMIT_STATUS,
  TRIP_SELECT_FOR_ROBOT,
  assertRobotSubmissionPreflight,
  getRobotSubmissionDiagnostic,

} from "@/lib/billingHelpers";
import { REAL_SUBMISSIONS_PAUSED } from "@/lib/submissionPause";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateStateFormPdf, type Leg } from "@/lib/medicaidPdf";
import { extractConfirmationNumber, normalizeCapturedClaim } from "@/lib/claimReview";
import { duplicateClaimError } from "@/lib/duplicateSubmit";
import type { SkipCode } from "@/lib/submitSkip";



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
    await assertBilling(supabase, userId);

    const statuses = data.statuses ?? (data.status ? [data.status] : []);
    if (!statuses.length) throw new Error("statuses required");

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
      // Paper bills carry the driver written on the form; that wins over the
      // staff account that keyed the bill in.
      driver_name:
        (r.medicaid_trips?.paper_driver_name?.trim() || null) ??
        (profiles[r.medicaid_trips?.driver_id]
          ? `${profiles[r.medicaid_trips.driver_id].first_name ?? ""} ${profiles[r.medicaid_trips.driver_id].last_name ?? ""}`.trim()
          : "—"),
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
    await assertBilling(supabase, userId);
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
    await assertBilling(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `*, medicaid_trips(*, riders(full_name, medicaid_id, dob, last_4_ssn, phone, address), medicaid_trip_legs(*))`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const trip = rec.medicaid_trips as any;

    let driver_name = trip?.paper_driver_name?.trim() || "—";
    if (driver_name === "—" && trip?.driver_id) {
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

    const robot_diagnostic = await getRobotSubmissionDiagnostic(supabase, {
      billingRecordId: data.id,
      trip,
      providerUserId: userId,
      mode: "full",
    });

    return { record: rec, trip, driver_name, signature_url, pdf_url, audit: audit ?? [], robot_diagnostic };
  });

export const regenerateBillingPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

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
    await assertBilling(supabase, userId);

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
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        /**
         * "capture" keeps the legacy two-pass behaviour. "full" runs the whole
         * job in one shot (fill + submit + confirm) with no human checkpoint
         * in between — used by the paper-bill flow.
         */
        mode: z.enum(["capture", "full", "debug_confirm_page"]).default("full"),
        /**
         * Set by the UI only after the biller explicitly confirmed the
         * "this may create a duplicate claim" warning dialog.
         */
        acknowledge_duplicate: z.boolean().default(false),

      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    // Operator pause switch (database-backed, applies to every worker and
    // every entry point). Capture-only runs stay allowed.
    if (data.mode === "full") {
      const { isSubmissionQueuePaused } = await import("@/lib/submissionQueue.server");
      const { paused, reason } = await isSubmissionQueuePaused(supabase);
      if (paused) {
        throw new Error(
          reason ?? "Automatic portal submissions are paused. Resume them in Billing settings.",
        );
      }
    }

    // REAL SUBMISSIONS PAUSED — enforced on the server, not just hidden in the
    // UI, so no path (queue release, retry, direct call) can start a real
    // portal submission while the pause is on. Capture-only runs stay allowed.
    if (REAL_SUBMISSIONS_PAUSED && data.mode === "full") {
      throw new Error(
        "Real portal submissions are paused while service-line verification is being fixed. " +
          "Capture-only runs are still allowed.",
      );
    }

    const { data: rec, error: recErr } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id, submission_error,
         requires_human_step,
         medicaid_trips!inner(
           id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
           state_pdf_path, identity_verified, robot_last_status, status, portal_status,
           robot_confirmation_number, submitted_confirmation,

           vehicle_type, trip_kind, rider_id,
           riders(medicaid_id)
         )`,
      )
      .eq("id", data.id)
      .single();
    if (recErr) throw new Error(recErr.message);

    const tripRow: any = rec.medicaid_trips;
    const priorClaim: string | null =
      tripRow?.robot_confirmation_number ?? tripRow?.submitted_confirmation ?? null;
    const unverified = tripRow?.robot_last_status === UNVERIFIED_SUBMIT_STATUS;
    const isResubmit = !!priorClaim || unverified;

    // Duplicate-submission guard. Not a hard block: suspended claims legitimately
    // need to be corrected and resubmitted, so the UI must show an explicit
    // warning and send acknowledge_duplicate once the biller confirms.
    if (isResubmit && !data.acknowledge_duplicate) {
      throw duplicateClaimError({
        claim: priorClaim,
        status: String(tripRow?.portal_status ?? tripRow?.status ?? rec.status ?? "unknown"),
        unverified,
      });
    }

    const allowed = ["approved", "needs_fix", "submitting", "queued"];
    // Diagnostic runs never submit, so they may start from any state.
    if (data.mode === "debug_confirm_page") allowed.push(...["pending_submit", "submitted", "needs_review", "draft", "ready"]);

    // A previously captured claim (legacy two-pass) can be finished with a
    // single one-shot job instead of the separate confirm step.
    if (data.mode === "full") allowed.push("pending_submit");
    // An acknowledged resubmission may start from an already-submitted record.
    if (isResubmit && data.acknowledge_duplicate) allowed.push("submitted", "pending_submit");

    if (!allowed.includes(rec.status as string)) {
      throw new Error(`Trip is in "${rec.status}" and cannot be submitted from here`);
    }

    const trip: any = rec.medicaid_trips;
    if (!trip) throw new Error("Trip not found");
    if (rec.requires_human_step) {
      throw new Error(
        rec.submission_error ||
          "This bill needs verification before another automatic submission can start.",
      );
    }

    try {
      if (data.mode !== "debug_confirm_page") {
        await assertRobotSubmissionPreflight(supabase, {
          billingRecordId: data.id,
          trip,
          providerUserId: userId,
          mode: data.mode,
        });
      }
      // Serialize against the portal session: if another job for this company
      // is live, this record is parked as `queued` and starts on its own.
      const { enqueueOrStartRobot } = await import("@/lib/robotQueue.server");
      const queueResult = await enqueueOrStartRobot(supabase, {
        billingRecordId: data.id,
        companyId: trip.company_id ?? null,
        trip,
        providerUserId: userId,
        mode: data.mode,
      });
      if (isResubmit) {
        // Mark the trip so status polling knows this job is a deliberate
        // resubmission and not a stale poll against the old claim.
        await supabase
          .from("medicaid_trips")
          .update({ robot_pass: "resubmit" })
          .eq("id", trip.id);
        await logAudit(
          supabase,
          data.id,
          userId,
          "resubmission_confirmed",
          `Intentional resubmission confirmed by billing staff at ${new Date().toISOString()}. ` +
            `Previous claim #${priorClaim ?? "unknown"}` +
            (unverified ? " (previous outcome unverified)" : "") +
            `. Mode: ${data.mode}.`,
        );
      }
      if (!queueResult.queued) {
        await logAudit(
          supabase,
          data.id,
          userId,
          data.mode === "full" ? "robot_started_full_submit" : "robot_started",
        );
      }
      return { ok: true, queued: queueResult.queued, ahead: queueResult.ahead };

    } catch (e: any) {
      const raw = e?.message ?? "Failed to start automation";
      const { sanitizeSubmitError, isPreSubmitPacingCondition } = await import("@/lib/submitErrors");
      const msg = sanitizeSubmitError(raw);

      // PRE-SUBMIT PACING (account busy / browser never launched): nothing was
      // sent, so the bill stays queued for capacity — never Needs Fix, never a
      // human-step flag.
      if (isPreSubmitPacingCondition(raw)) {
        await supabase
          .from("billing_records")
          .update({ status: "queued", submission_error: msg, requires_human_step: false })
          .eq("id", data.id);
        await logAudit(supabase, data.id, userId, "submit_paced", raw.slice(0, 400));
        return { ok: true, queued: true, ahead: null, paced: true };
      }

      await supabase
        .from("billing_records")
        .update({
          status: "needs_fix",
          submission_error: msg,
          fix_notes: raw.slice(0, 500),
          submit_last_error: raw.slice(0, 500),
          requires_human_step: true,
        })
        .eq("id", data.id);

      await logAudit(supabase, data.id, userId, "robot_start_failed", raw.slice(0, 400));
      throw new Error(msg);
    }
  });

/**
 * BULK SUBMIT ("Submit All" / "Submit Claims" on the Ready-to-Submit tab).
 *
 * Every selected record is parked as `queued` in one pass, then the shared
 * queue dispatcher fills all free concurrency slots at once (up to
 * MAX_CONCURRENT_ROBOT_JOBS). Anything beyond the slots stays `queued` and is
 * picked up automatically by the background sweep as jobs finish — the same
 * path proven by the queue fix. Never dispatch per-record from the client: a
 * serial loop is slow and parallel client calls race on the slot count.
 */
export const startRobotForRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        acknowledge_duplicate: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    if (REAL_SUBMISSIONS_PAUSED) {
      throw new Error(
        "Real portal submissions are paused while service-line verification is being fixed.",
      );
    }

    const { isSubmissionQueuePaused, dispatchLeasedSubmissions } = await import(
      "@/lib/submissionQueue.server"
    );
    const { paused, reason } = await isSubmissionQueuePaused(supabase);
    if (paused) {
      throw new Error(
        reason ?? "Automatic portal submissions are paused. Resume them in Billing settings.",
      );
    }

    const { data: recs, error: recErr } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id, requires_human_step,
         medicaid_trips!inner(
            id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
            state_pdf_path, identity_verified, robot_last_status, status, portal_status,
            robot_confirmation_number, submitted_confirmation,
            vehicle_type, trip_kind, rider_id,
            riders(medicaid_id)
         )`,
      )
      .in("id", data.ids);
    if (recErr) throw new Error(recErr.message);

    const allowed = ["approved", "needs_fix", "pending_submit", "queued"];
    const skipped: Array<{ id: string; reason: string; code: SkipCode; claim?: string | null }> = [];
    const duplicates: string[] = [];
    const companies = new Set<string | null>();
    const candidates: Array<{
      id: string;
      companyId: string | null;
      tripId: string;
      serviceDate: string | null;
      resubmit: boolean;
    }> = [];

    for (const rec of recs ?? []) {
      const trip: any = (rec as any).medicaid_trips;
      const priorClaim: string | null =
        trip?.robot_confirmation_number ?? trip?.submitted_confirmation ?? null;
      const unverified = trip?.robot_last_status === UNVERIFIED_SUBMIT_STATUS;
      const isResubmit = !!priorClaim || unverified;

      if (isResubmit && !data.acknowledge_duplicate) {
        duplicates.push(rec.id as string);
        // A real claim number is terminal evidence; an unverified outcome is
        // NOT a submitted claim and must never be labelled as one.
        skipped.push(
          priorClaim
            ? {
                id: rec.id as string,
                code: "submitted_claim",
                claim: priorClaim,
                reason: `already submitted as claim #${priorClaim}`,
              }
            : {
                id: rec.id as string,
                code: "unverified_outcome",
                claim: null,
                reason: "previous attempt reached the portal but was never verified",
              },
        );
        continue;
      }
      if ((rec as any).requires_human_step) {
        skipped.push({
          id: rec.id as string,
          code: "needs_verification",
          reason: "needs verification before retry",
        });
        continue;
      }
      if (!allowed.includes(rec.status as string) && !(isResubmit && data.acknowledge_duplicate)) {
        skipped.push({
          id: rec.id as string,
          code: "not_submittable",
          reason: `status "${rec.status}"`,
        });
        continue;
      }
      try {
        await assertRobotSubmissionPreflight(supabase, {
          billingRecordId: rec.id as string,
          trip,
          providerUserId: userId,
          mode: "full",
        });
      } catch (e) {
        // STEP-1 FAIL CLOSED: this bill is parked, the batch keeps going.
        const msg = e instanceof Error ? e.message : "Submission blocked: required claim data is missing.";
        skipped.push({ id: rec.id as string, code: "missing_data", reason: msg });
        await supabase
          .from("billing_records")
          .update({
            status: "needs_fix",
            submission_error: msg,
            fix_notes: msg,
            requires_human_step: true,
            failure_stage: "preflight",
            failure_code: "missing_required_data",
          })
          .eq("id", rec.id);
        continue;
      }

      candidates.push({
        id: rec.id as string,
        companyId: trip?.company_id ?? null,
        tripId: (rec as any).trip_id ?? trip?.id,
        serviceDate: trip?.pickup_at ?? null,
        resubmit: isResubmit && data.acknowledge_duplicate,
      });
      companies.add(trip?.company_id ?? null);
    }

    if (candidates.length === 0) {
      return {
        queued: 0,
        started: 0,
        startedIds: [] as string[],
        skipped,
        duplicates,
        batch_id: null as string | null,
      };
    }

    // ENQUEUE ONLY, ACCOUNT-SCOPED AND IDEMPOTENT. The click never waits on
    // portal work: every selected bill is persisted as `queued`, stamped with
    // the HCPF account key it must serialize on plus an immutable idempotency
    // key, and the leasing workers (in-app sweep + one-minute cron) dispatch
    // them within the per-account and global caps. Crash-safe by construction.
    const { enqueueSubmissionBatch } = await import("@/lib/submissionBatch.server");
    const batch = await enqueueSubmissionBatch(supabase, {
      actorId: userId,
      candidates,
      label: `Batch of ${candidates.length}`,
    });
    duplicates.push(...batch.duplicates);
    // Idempotency collapse: the bill is already queued/sending. No evidence of
    // a submitted claim, so this must never look like "already submitted".
    for (const d of batch.duplicates)
      skipped.push({
        id: d,
        code: "already_queued",
        reason: "already queued or sending — the duplicate request was ignored",
      });
    for (const f of batch.failed)
      skipped.push({ id: f.id, code: "enqueue_failed", reason: f.reason });

    // Best-effort immediate kick so the first bill starts without waiting for
    // the next tick. Bounded by the same leases: it can never exceed the caps,
    // and anything not started simply stays queued.
    const startedIds: string[] = [];
    for (const companyId of companies) {
      try {
        const res = await dispatchLeasedSubmissions(supabase, userId, {
          companyId: companyId ?? null,
          worker: `bulk-${userId.slice(0, 8)}`,
        });
        startedIds.push(...res.startedIds);
      } catch {
        // Anything not started stays `queued`; the workers retry it.
      }
    }

    return {
      queued: batch.enqueued.length,
      started: startedIds.length,
      startedIds,
      skipped,
      duplicates,
      batch_id: batch.batchId,
    };
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
    await assertBilling(supabase, userId);
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
    const { data: rec } = await supabase
      .from("billing_records")
      .select("trip_id")
      .eq("id", data.id)
      .maybeSingle();
    if (rec?.trip_id) {
      await supabase
        .from("medicaid_trips")
        .update({
          status: "submitted",
          submitted_confirmation: data.confirmation_number,
          robot_confirmation_number: data.confirmation_number,
          portal_confirmation: data.confirmation_number,
          portal_status: "submitted",
          portal_submitted_at: nowIso,
          submitted_at: nowIso,
          submitted_by: userId,
        })
        .eq("id", rec.trip_id);
    }
    await logAudit(
      supabase,
      data.id,
      userId,
      "portal_submitted",
      `Confirmation #${data.confirmation_number}`,
    );
    return { ok: true };
  });




/**
 * PASS 2 — the human reviewed the captured claim and tapped "Confirm & Submit".
 * Opens a fresh robot session that re-fills the claim and clicks through the
 * portal's Submit + "Confirm Professional Claim" checkpoint for real.
 */
export const confirmAndSubmitClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(TRIP_SELECT_FOR_ROBOT)
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const trip: any = rec.medicaid_trips;
    if (!trip) throw new Error("Trip not found");
    if (!trip.robot_captured_claim) {
      throw new Error(
        "No captured claim to confirm yet — run the automation capture pass first.",
      );
    }

    try {
      const { enqueueOrStartRobot } = await import("@/lib/robotQueue.server");
      const queueResult = await enqueueOrStartRobot(supabase, {
        billingRecordId: data.id,
        companyId: trip.company_id ?? null,
        trip,
        providerUserId: userId,
        mode: "submit",
      });
      if (!queueResult.queued) {
        await logAudit(supabase, data.id, userId, "claim_confirmed_submitting");
      }
      return { ok: true, queued: queueResult.queued, ahead: queueResult.ahead };

    } catch (e: any) {
      const raw = e?.message ?? "Could not start the real submission";
      const { sanitizeSubmitError } = await import("@/lib/submitErrors");
      const msg = sanitizeSubmitError(raw);
      await supabase
        .from("billing_records")
        .update({
          status: "pending_submit",
          requires_human_step: true,
          submission_error: msg,
          submit_last_error: raw.slice(0, 500),
        })
        .eq("id", data.id);
      await logAudit(supabase, data.id, userId, "claim_confirm_failed", raw.slice(0, 400));
      throw new Error(msg);
    }
  });

/**
 * The human tapped "Cancel" on the review screen. Nothing touches the portal —
 * the record simply stays where it is, with the review discarded.
 */
export const cancelClaimReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    await logAudit(
      supabase,
      data.id,
      userId,
      "claim_review_cancelled",
      "Reviewer cancelled — no portal session was opened.",
    );
    return { ok: true };
  });


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
    await assertBilling(supabase, userId);
    const { reconcileRobotJob } = await import("@/lib/robotReconcile.server");
    const out = await reconcileRobotJob(supabase, data.id, userId);
    if (!out.pending) {
      const { dispatchNextQueued } = await import("@/lib/robotQueue.server");
      await dispatchNextQueued(supabase, userId);
    }
    return out;
  });


export const requestFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), notes: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

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
    await assertBilling(supabase, userId);
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
    await assertBilling(supabase, userId);
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
    await assertBilling(supabase, userId);
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
    await assertBilling(supabase, userId);
    // Credentials are always bound to the caller's own company.
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);
    const { data: id, error } = await supabase.rpc("upsert_portal_credential", {
      _portal_id: data.portal_id,
      _portal_name: data.portal_name,
      _state: data.state,
      _login_email: data.login_email,
      _login_password: data.login_password,
      _company_id: companyId,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

export const deletePortalCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { error } = await supabase
      .from("state_portal_credentials")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- BILLING SETTINGS ---------- */

export const getBillingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);
    const { data, error } = await supabase
      .from("billing_settings")
      .select("id, company_id, default_portal_id")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return {
      default_portal_id: data?.[0]?.default_portal_id ?? null,
    };
  });


export const setDefaultBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ portal_id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);
    const { error } = await supabase.rpc("set_default_billing_portal", {
      _portal_id: data.portal_id,
      _company_id: companyId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- SUBMISSION QUEUE + CANCEL ---------- */

/**
 * Queue visibility for the "Processing" / in-flight lists.
 * The automation service runs up to MAX_CONCURRENT_ROBOT_JOBS portal sessions
 * per account at once, so EVERY `submitting` record is genuinely running —
 * never label one of them "queued" just because another job started first.
 * Only `queued` records are actually waiting.
 */
export const listSubmissionQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { MAX_CONCURRENT_ROBOT_JOBS } = await import("@/lib/robotQueue.server");


    const { data: rows, error } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id, submission_error, requires_human_step, updated_at,
         medicaid_trips!inner(
           id, pickup_at, robot_job_id, robot_pass, robot_last_status, robot_last_message,
           robot_job_started_at, robot_confirmation_number, riders(full_name, medicaid_id)
         )`,
      )
      .in("status", ["submitting", "queued", "pending_submit"])
      .order("updated_at", { ascending: true });
    if (error) throw new Error(error.message);

    const running = (rows ?? []).filter((r: any) => r.status === "submitting");
    const parked = (rows ?? []).filter((r: any) => r.status === "queued");
    return (rows ?? []).map((r: any) => {
      const trip = r.medicaid_trips ?? {};
      const startedAt: string | null =
        r.status === "queued" ? null : (trip.robot_job_started_at ?? null);
      const elapsedMin = startedAt
        ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000))
        : null;
      const aheadInQueue =
        r.status === "queued" ? parked.findIndex((x: any) => x.id === r.id) : null;

      let queue_state: "queued" | "running" | "awaiting_review" | "submitted";
      let queue_label: string;
      if (trip.robot_confirmation_number) {
        queue_state = "submitted";
        queue_label = `Submitted — claim #${trip.robot_confirmation_number}`;
      } else if (r.status === "pending_submit") {
        queue_state = "awaiting_review";
        queue_label = "Needs verification";
      } else if (r.status === "queued") {
        // Controlled account capacity: several DIFFERENT riders process in
        // parallel, so everything else honestly waits for a free slot.
        const ahead = (aheadInQueue ?? 0) + running.length;
        queue_state = "queued";
        queue_label =
          ahead > 0
            ? `Waiting for submission slot — ${ahead} claim${ahead === 1 ? "" : "s"} ahead`
            : "Waiting for submission slot";
      } else {
        // An actively running submission on this provider account.
        queue_state = "running";
        queue_label = "Submitting to HCPF";
      }



      return {
        id: r.id,
        trip_id: r.trip_id,
        status: r.status,
        passenger_name: trip.riders?.full_name ?? null,
        medicaid_id: trip.riders?.medicaid_id ?? null,
        pickup_at: trip.pickup_at ?? null,
        robot_pass: trip.robot_pass ?? null,
        robot_last_status: trip.robot_last_status ?? null,
        robot_last_message: trip.robot_last_message ?? null,
        robot_confirmation_number: trip.robot_confirmation_number ?? null,
        started_at: startedAt,
        elapsed_minutes: elapsedMin,
        queue_state,
        queue_label,
        cancellable: !trip.robot_confirmation_number,
      };
    });
  });

/**
 * Cancel a submission BEFORE the real Medicaid submit has gone through and
 * return the trip to the review stage. A claim that already carries a real
 * portal confirmation number can never be cancelled from here.
 */
export const cancelSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id, state_confirmation_number,
         medicaid_trips!inner(id, robot_confirmation_number, submitted_confirmation, portal_confirmation, status)`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const trip: any = rec.medicaid_trips;

    const alreadySubmitted =
      rec.status === "submitted" ||
      !!rec.state_confirmation_number ||
      !!trip?.robot_confirmation_number ||
      !!trip?.submitted_confirmation ||
      !!trip?.portal_confirmation;
    if (alreadySubmitted) {
      throw new Error(
        "This claim has already been submitted to Medicaid" +
          (trip?.robot_confirmation_number ? ` (claim #${trip.robot_confirmation_number})` : "") +
          ". A real submitted claim cannot be cancelled here — void or adjust it in the state portal instead.",
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
      .eq("id", rec.trip_id);

    const { error: updErr } = await supabase
      .from("billing_records")
      .update({
        status: "approved",
        requires_human_step: false,
        submission_error: null,
      })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    await logAudit(
      supabase,
      data.id,
      userId,
      "submission_cancelled",
      "Cancelled before the real portal submission — returned to Ready to Submit.",
    );
    return { ok: true };
  });

/* ---------- DELETE (remove bills from the workflow) ---------- */

/**
 * Permanently removes billing records from the workflow. Only bills that have
 * NOT been submitted can be deleted; the underlying trip is marked rejected so
 * it doesn't silently reappear.
 */
export const deleteBillingRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const { data: recs, error } = await supabase
      .from("billing_records")
      .select("id, status, trip_id, state_confirmation_number")
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    const { performBillDelete, PERMISSION_MESSAGE } = await import("@/lib/deleteBills");
    // RLS hides bills entered by another biller, so an empty read is itself a
    // permission problem — not "nothing to do".
    if (!recs?.length) throw new Error(PERMISSION_MESSAGE);

    return await performBillDelete(supabase, recs as any);
  });


/* ---------- BACKGROUND STATUS SWEEP ---------- */

/**
 * Reconcile every in-flight robot job for the caller's company and release the
 * next queued submission. Called on a timer by the billing app so results land
 * within seconds of the robot finishing, whether or not a detail sheet is open.
 */
export const sweepRobotJobsForCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { sweepRobotJobs } = await import("@/lib/robotQueue.server");
    // RLS already scopes billing_records to the caller's company.
    return await sweepRobotJobs(supabase, userId);
  });
