/**
 * SERVER-SIDE HELPERS for the billing workflow.
 *
 * These live outside `billing.functions.ts` on purpose: files that declare
 * server functions must stay thin wrappers, otherwise the build's server-fn
 * splitting strips module-scope runtime code and the whole module throws at
 * request time.
 */
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Leg } from "@/lib/medicaidPdf";
import { legMiles } from "@/lib/claimCalc";

/**
 * Billed miles are ALWAYS computed in code from odometer readings —
 * (dropoff − pickup) per leg, summed across legs. No miles value is ever read
 * from a paper form, OCR output or any other free-text source.
 */
export function computeBilledMiles(
  legs: { pickup_odometer: number; dropoff_odometer: number }[],
): number {
  return Math.round(legs.reduce((sum, l) => sum + legMiles(l), 0) * 10) / 10;
}


/** Utility: verify admin, throw on failure. Reserved for platform-level
 *  settings; billing settings are managed by billing staff themselves. */
export async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

/** Billing workspace access — admins and dedicated billing staff. Company
 *  isolation is still enforced by RLS on every table underneath. */
export async function assertBilling(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("current_user_can_bill");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: billing staff only");
  void userId;
}

export const StatusEnum = z.enum([
  "pending_review",
  "pending_submit",
  "queued",
  "submitting",
  "submitted",
  "approved",
  "rejected",
  "needs_fix",
]);

export const ALL_STATUSES = [
  "pending_review",
  "approved",
  "queued",
  "submitting",
  "needs_fix",
  "pending_submit",
  "submitted",
  "rejected",
] as const;


export async function logAudit(
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

export function getRequestOrigin(): string {
  const origin = getRequestHeader("origin");
  if (origin) return origin;
  const host = getRequestHeader("x-forwarded-host") ?? getRequestHeader("host");
  const proto = getRequestHeader("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:8080";
}

export function normalizeTripLegs(trip: any): Leg[] {
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

export const ROBOT_BASE_URL =
  "https://redart-hcpf-automation-production.up.railway.app";

export function formatTripDateMDY(pickupAt: string | null | undefined): string {
  const d = pickupAt ? new Date(pickupAt) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const mm = String(safe.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(safe.getUTCDate()).padStart(2, "0");
  const yyyy = safe.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export const RATES_NOT_CONFIGURED_MESSAGE =
  "Billing rates not configured for this company — set them in Billing Settings first";

export const NO_PORTAL_CREDENTIAL_MESSAGE =
  "No portal login configured for this company — add one in Team & apps first";

/**
 * FAIL CLOSED ON PORTAL LOGINS.
 *
 * A portal login belongs to exactly one company. It is never shared, never
 * defaulted and never borrowed from another company — submitting under someone
 * else's provider identity is a compliance incident, not an inconvenience.
 */
export async function requireCompanyPortalCredential(
  supabase: any,
  companyId: string,
  portalId?: string | null,
): Promise<{ portal_id: string; login_email: string }> {
  let q = supabase
    .from("state_portal_credentials")
    .select("portal_id, login_email")
    .eq("company_id", companyId);
  if (portalId) q = q.eq("portal_id", portalId);
  const { data, error } = await q.limit(1);
  if (error) {
    throw new Error(`Could not verify the portal login for this company: ${error.message}`);
  }
  const row = (data ?? [])[0];
  if (!row) throw new Error(NO_PORTAL_CREDENTIAL_MESSAGE);
  return { portal_id: String(row.portal_id), login_email: String(row.login_email) };
}


type ResolvedRate = {
  procedure_code: string;
  charge_amount: number;
  place_of_service: string | null;
};

/**
 * Resolve the billing rates that belong to the TRIP'S OWN COMPANY.
 * Throws (fails closed) when the company is unknown or has no configured
 * trip/mileage rate for the vehicle type being billed.
 */
export async function requireCompanyRates(
  supabase: any,
  trip: any,
  vehicleType: string,
): Promise<{
  companyId: string;
  trip: ResolvedRate;
  mile: ResolvedRate;
  diagnosis_code: string | null;
}> {
  let companyId: string | null = trip?.company_id ?? null;
  if (!companyId) {
    const { data } = await supabase
      .from("medicaid_trips")
      .select("company_id")
      .eq("id", trip.id)
      .single();
    companyId = data?.company_id ?? null;
  }
  if (!companyId) {
    throw new Error(`${RATES_NOT_CONFIGURED_MESSAGE} (no company linked to this trip)`);
  }

  const { data: rows, error } = await supabase
    .from("billing_rate_settings")
    .select("vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code")
    .eq("company_id", companyId)
    .eq("vehicle_type", vehicleType);
  if (error) throw new Error(`Could not read billing rates: ${error.message}`);

  const pick = (unit: "trip" | "mile") => {
    const r = (rows ?? []).find((x: any) => x.unit_type === unit);
    if (!r || !r.procedure_code || !(Number(r.charge_amount) > 0)) return null;
    return {
      procedure_code: String(r.procedure_code),
      charge_amount: Number(r.charge_amount),
      place_of_service: r.place_of_service ? String(r.place_of_service) : null,
    } satisfies ResolvedRate;
  };
  const tripRate = pick("trip");
  const mileRate = pick("mile");
  const missing = [!tripRate && "trip", !mileRate && "mileage"].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `${RATES_NOT_CONFIGURED_MESSAGE} (missing ${missing.join(" and ")} rate for ${vehicleType}). Submission blocked.`,
    );
  }

  const diag = (rows ?? []).find((r: any) => r.default_diagnosis_code)?.default_diagnosis_code;
  return {
    companyId,
    trip: tripRate!,
    mile: mileRate!,
    diagnosis_code: diag ? String(diag) : null,
  };
}

export async function startRobotSubmission(
  supabase: any,
  args: {
    billingRecordId: string;
    trip: any;
    providerUserId: string;
    /**
     * "capture" = PASS 1 (fill + read back, never submit).
     * "submit"  = PASS 2 (confirm a previously captured claim).
     * "full"    = one-shot: fill, read back AND click Submit + Confirm.
     */
    mode?: "capture" | "submit" | "full";
  },
) {
  const { billingRecordId, trip, providerUserId } = args;
  const mode = args.mode ?? "capture";
  const rider = trip.riders;
  const medicaidMemberId: string | null = rider?.medicaid_id ?? null;
  if (!medicaidMemberId) {
    throw new Error("Rider has no Medicaid member ID");
  }

  // Unique job id per submission attempt. Server-side timestamp keeps it
  // monotonic even if two attempts race.
  const jobId = `trip-${trip.id}-${mode}-${Date.now()}`;
  /** Anything that is not a pure capture really submits at the portal. */
  const doesSubmit = mode !== "capture";

  // Never trust a caller's relation projection for proof/signature fields.
  // The Ready-to-Submit path previously omitted state_pdf_path from its select,
  // which made paper bills look unsigned even though the canonical trip row had
  // the uploaded signed report. Re-read these safety-critical values directly.
  const { data: proofRow, error: proofError } = await supabase
    .from("medicaid_trips")
    .select("signature_path, state_pdf_path, identity_verified")
    .eq("id", trip.id)
    .single();
  if (proofError) {
    throw new Error(`Could not verify the trip signature before submission: ${proofError.message}`);
  }
  const signatureCaptured = Boolean(proofRow?.signature_path || proofRow?.state_pdf_path);
  if (doesSubmit && !signatureCaptured) {
    throw new Error("Submission blocked: this trip has no signed report on file");
  }

  // FAIL CLOSED ON RATES.
  // The automation service looks rates up itself and will otherwise fall back
  // to built-in defaults (place of service 99 and stock dollar amounts) when a
  // company has none configured — which silently bills wrong money at the
  // portal. Resolve the company's own rates here and refuse to start a job
  // unless both the trip and mileage rates exist for this vehicle type.
  const vehicleType = (trip.vehicle_type as string | null) ?? "ambulatory";
  const rates = await requireCompanyRates(supabase, trip, vehicleType);

  // FAIL CLOSED ON PORTAL IDENTITY.
  // Refuse to start a job unless THIS company owns a portal login of its own.
  const credential = await requireCompanyPortalCredential(supabase, rates.companyId);


  // BILLED MILES ARE ALWAYS CALCULATED, NEVER READ.
  // Re-read the canonical odometer legs and compute (dropoff − pickup) per leg,
  // summed. For a round trip this bills leg 1 + leg 2 only — never the raw
  // start→end span, which would wrongly include the gap between legs.
  const { data: legRows, error: legErr } = await supabase
    .from("medicaid_trip_legs")
    .select("leg_index, pickup_odometer, dropoff_odometer")
    .eq("medicaid_trip_id", trip.id)
    .order("leg_index");
  if (legErr) {
    throw new Error(`Could not read the odometer legs for this trip: ${legErr.message}`);
  }
  const odometerLegs = (legRows?.length ? legRows : [
    { pickup_odometer: trip.odometer_start, dropoff_odometer: trip.odometer_end },
  ]).map((l: any) => ({
    pickup_odometer: Number(l.pickup_odometer ?? 0),
    dropoff_odometer: Number(l.dropoff_odometer ?? 0),
  }));
  const billedMiles = computeBilledMiles(odometerLegs);
  if (doesSubmit && billedMiles <= 0) {
    throw new Error("Submission blocked: odometer readings give 0 billable miles");
  }
  const billedOdometerStart = Number(odometerLegs[0]?.pickup_odometer ?? 0);
  // Round trip = two real billable legs (matches calcClaim/resolveTripKind).
  const isRoundTrip =
    trip.trip_kind === "round_trip" ||
    odometerLegs.filter((l: { pickup_odometer: number; dropoff_odometer: number }) => legMiles(l) > 0).length >= 2;

  const tripUnits = isRoundTrip ? 2 : 1;



  const payload = {
    id: jobId,
    medicaid_trip_id: trip.id,
    provider_id: providerUserId,
    company_id: rates.companyId,
    // Portal login is company-owned; tell the robot exactly which one to fetch.
    portal_id: credential.portal_id,
    vehicle_type: vehicleType,
    // MEMBER ID vs PATIENT NUMBER — two different portal fields. The member
    // id is the state Medicaid id; the internal job id ("trip-<uuid>-...")
    // must only ever reach the Patient Number / account-number box, so both
    // are now sent explicitly instead of leaving the robot to pick one.
    medicaid_member_id: medicaidMemberId,
    member_id: medicaidMemberId,
    medicaid_id: medicaidMemberId,
    patient_number: trip.id,
    patient_account_number: trip.id,
    // Date of service. Aliases cover whichever key the robot reads; a blank
    // date on the claim means none of these were picked up.
    trip_date: formatTripDateMDY(trip.pickup_at),
    service_date: formatTripDateMDY(trip.pickup_at),
    date_of_service: formatTripDateMDY(trip.pickup_at),
    from_date: formatTripDateMDY(trip.pickup_at),
    to_date: formatTripDateMDY(trip.pickup_at),

    // Explicit rates so the automation service never has to guess or fall back
    // to its own built-in defaults.
    trip_rate: rates.trip,
    mile_rate: rates.mile,
    place_of_service: rates.trip.place_of_service,
    // Diagnosis (illness) code. Confirmed being sent as diagnosis_code yet
    // blank on a real claim — same alias pattern as member id / date of
    // service, so every reasonable key the robot might read is sent.
    diagnosis_code: rates.diagnosis_code,
    diagnosis: rates.diagnosis_code,
    primary_diagnosis: rates.diagnosis_code,
    primary_diagnosis_code: rates.diagnosis_code,
    dx_code: rates.diagnosis_code,
    icd_code: rates.diagnosis_code,
    icd10_code: rates.diagnosis_code,
    diagnosis_codes: rates.diagnosis_code ? [rates.diagnosis_code] : [],
    // Paper-originated bills have no digital signature row: the physical
    // signature lives on the uploaded paper report stored as state_pdf_path.
    signature_captured: signatureCaptured,
    // Portal Step 1: "Does the provider have a signature on file?" — a field
    // SEPARATE from the driver/member identity question. Business rule: we
    // never bill without a signed trip report, so this is always Yes.
    // Aliases cover whichever key the automation service implements.
    provider_signature_on_file: signatureCaptured,
    signature_on_file: signatureCaptured,
    provider_has_signature_on_file: signatureCaptured,
    // "Did the Driver verify the member's identity?" at the portal. Explicit
    // aliases so the robot reads whichever key it implements.
    identity_verified: proofRow?.identity_verified !== false,
    member_identity_verified: proofRow?.identity_verified !== false,

    // PROVEN BEHAVIOUR OF THE AUTOMATION SERVICE (2026-08-13):
    // it fills the mileage service line with (dropoff_odometer − pickup_odometer)
    // and IGNORES miles/mileage_units/total_miles. For a round trip that raw
    // span includes the gap between legs, which over-bills mileage massively
    // (real case: 93 units billed where the true billable distance is 4).
    // So the odometer pair we send is now derived from the SAME computed
    // billable miles the app shows, keeping every derivation path identical.
    pickup_odometer: billedOdometerStart,
    dropoff_odometer: Math.round((billedOdometerStart + billedMiles) * 10) / 10,
    raw_odometer_start: Number(trip.odometer_start ?? 0),
    raw_odometer_end: Number(trip.odometer_end ?? 0),
    // Authoritative mileage units for the claim — computed here from the
    // odometer legs so the automation service never derives or reads its own.
    miles: billedMiles,
    mileage_units: billedMiles,
    total_miles: billedMiles,
    odometer_legs: odometerLegs,
    is_round_trip: isRoundTrip,
    // Explicit TRIP (base) service-line units. Previously only is_round_trip
    // was sent and the robot decided the unit count itself, which billed a
    // single unit for round trips. Aliases cover whichever key it reads.
    trip_units: tripUnits,
    units: tripUnits,
    trip_unit_count: tripUnits,
    base_units: tripUnits,


    // Two-pass contract with the automation service. Aliases are sent so the
    // robot can read whichever flag name it implements.
    // The robot expects "confirm_submit" for a real fill → submit → confirm run.
    mode: doesSubmit ? "confirm_submit" : mode,
    i_understand_this_is_real: doesSubmit,
    capture_only: mode === "capture",
    return_captured_data: mode === "capture",
    close_session: true,
    confirm_submit: doesSubmit,
    click_submit: doesSubmit,
  };

  // Persist the safety-critical outbound values before contacting the robot.
  // This intentionally excludes member/provider identifiers and gives future
  // incident reviews the exact flags sent for a specific job attempt.
  const { error: payloadAuditError } = await supabase.from("billing_audit_log").insert({
    billing_record_id: billingRecordId,
    action: "robot_payload_prepared",
    actor_id: providerUserId,
    actor_type: "admin",
    notes: JSON.stringify({
      job_id: jobId,
      mode: payload.mode,
      signature_captured: payload.signature_captured,
      identity_verified: payload.identity_verified,
      has_signature_path: Boolean(proofRow?.signature_path),
      has_state_pdf_path: Boolean(proofRow?.state_pdf_path),
      capture_only: payload.capture_only,
      confirm_submit: payload.confirm_submit,
      click_submit: payload.click_submit,
      trip_date_sent: payload.trip_date,
      patient_number_sent: payload.patient_number,
      member_id_last4: String(payload.member_id ?? "").slice(-4),
      is_round_trip: payload.is_round_trip,
      diagnosis_code_sent: payload.diagnosis_code,

      trip_units: payload.trip_units,
      billed_miles: payload.miles,
      pickup_odometer_sent: payload.pickup_odometer,
      dropoff_odometer_sent: payload.dropoff_odometer,
      raw_odometer_start: payload.raw_odometer_start,
      raw_odometer_end: payload.raw_odometer_end,

    }),
  });
  if (payloadAuditError) {
    throw new Error(`Could not record the robot payload audit: ${payloadAuditError.message}`);
  }

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
      robot_pass: doesSubmit ? "submit" : "capture",
      ...(mode === "capture"
        ? { robot_captured_claim: null, robot_captured_at: null }
        : {}),
    })
    .eq("id", trip.id);

  await supabase
    .from("billing_records")
    .update({
      status: "submitting",
      submission_error: null,
      requires_human_step: false,
    })
    .eq("id", billingRecordId);
}

export const TRIP_SELECT_FOR_ROBOT = `id, status, trip_id,
   medicaid_trips!inner(
     id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
     state_pdf_path, identity_verified,
     vehicle_type, trip_kind, rider_id, robot_captured_claim,
     riders(medicaid_id)
   )`;

/**
 * FALSE-FAILURE GUARD.
 *
 * The HCPF portal's Confirm button posts back slowly. Playwright can click it
 * successfully and then time out only while waiting for the resulting
 * navigation to settle. The automation service reports that as a hard error,
 * but the claim IS live at the portal — retrying would double-submit.
 *
 * Detects "the Confirm click landed, the wait afterwards timed out".
 */
export function looksLikePostConfirmTimeout(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = String(raw);
  const clickedConfirm =
    /ConfirmCmnButton/i.test(t) || /confirm/i.test(t);
  const clickLanded = /click action done/i.test(t);
  const timedOutAfter =
    /waiting for scheduled navigations to finish/i.test(t) || /Timeout \d+ms exceeded/i.test(t);
  return clickedConfirm && clickLanded && timedOutAfter;
}

/** Status parked on a trip whose claim may already exist at the portal. */
export const UNVERIFIED_SUBMIT_STATUS = "SUBMITTED_UNVERIFIED";
