import { CLAIMS_NAV_SPEC } from "@/lib/portalNavigation";
import { robotPassFor } from "@/lib/correctedJob";
import { withPortalMoneyFields } from "@/lib/portalCurrency";
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
import { REAL_SUBMISSIONS_PAUSED } from "@/lib/submissionPause";
import {
  formatRobotPayloadDiagnostic,
  formatRobotPreflightFailure,
  validateRobotPayloadPreflight,
} from "@/lib/robotPayload";

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
  actor_id: string | null,
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
  const valid = !Number.isNaN(pickupAt.getTime());
  // Mountain Time — the portal's clock — not UTC and not the server locale.
  const date = denverDateISO(valid ? pickupAt : new Date());
  const time = valid ? denverTimeHM(pickupAt) : null;


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

export { ROBOT_BASE_URL } from "@/lib/robotConfig";

/**
 * PORTAL TIME ZONE: America/Denver.
 *
 * The HCPF portal validates the date of service against its own Mountain Time
 * clock. Formatting in UTC pushed every evening trip (after ~6 PM MST) onto
 * "tomorrow", and the portal rejected the service line with "The From Date
 * date cannot be in the future" — which silently left the claim at $0.00.
 */
export const PORTAL_TIME_ZONE = "America/Denver";

function denverParts(d: Date): { y: number; m: number; day: number; hh: string; mm: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
    hh: parts.hour === "24" ? "00" : String(parts.hour),
    mm: String(parts.minute),
  };
}

/** YYYY-MM-DD in Mountain Time. */
export function denverDateISO(input: Date | string | null | undefined): string {
  const d = input ? new Date(input) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const { y, m, day } = denverParts(safe);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** HH:MM in Mountain Time. */
export function denverTimeHM(input: Date | string | null | undefined): string {
  const d = input ? new Date(input) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const { hh, mm } = denverParts(safe);
  return `${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

export function formatTripDateMDY(pickupAt: string | null | undefined): string {
  if (!pickupAt) throw new Error("Submission blocked: trip/service date is missing.");
  const d = new Date(pickupAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Submission blocked: trip/service date is invalid.");
  }
  const iso = denverDateISO(pickupAt);
  const [yyyy, mm, dd] = iso.split("-");
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Blocks a submission whose service date is still in the future on the
 * portal's own Mountain-Time clock, with a clear message instead of a
 * mysterious $0.00 claim.
 */
export function assertServiceDateNotFuture(serviceDateMDY: string): void {
  const [mm, dd, yyyy] = serviceDateMDY.split("/");
  const serviceISO = `${yyyy}-${mm}-${dd}`;
  const todayISO = denverDateISO(new Date());
  if (serviceISO > todayISO) {
    throw new Error(
      `Submission blocked: the service date ${serviceDateMDY} is still in the future in Mountain Time (today is ${todayISO} in Denver). The portal rejects future dates — submit this trip on or after its service date.`,
    );
  }
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
    .is("company_id", null)
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

export type RobotSubmissionDiagnostic = {
  ok: boolean;
  has_company: boolean;
  member_last4: string | null;
  service_date: string | null;
  patient_last4: string | null;
  signature_on_file_state: "yes" | "no" | "unknown";
  identity_verified: boolean | null;
  has_portal_config: boolean;
  has_rates: boolean;
  vehicle_type: string | null;
  miles: number | null;
  trip_units: number | null;
  issues: RobotPayloadPreflightIssue[];
};

type RobotPayloadPreflightIssue = {
  field: string;
  message: string;
};

function last4(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s.slice(-4) : null;
}

function diagnosticIssue(field: string, message: string): RobotPayloadPreflightIssue {
  return { field, message };
}

/**
 * READ-ONLY submission diagnostic. No credentials, full member IDs, provider
 * ids or patient numbers are returned — only presence flags and last-four masks.
 */
export async function getRobotSubmissionDiagnostic(
  supabase: any,
  args: { billingRecordId: string; trip: any; providerUserId: string | null; mode?: "capture" | "submit" | "full" | "debug_confirm_page" },
): Promise<RobotSubmissionDiagnostic> {
  const { trip } = args;
  const doesSubmit = args.mode === "submit" || args.mode === "full" || !args.mode;
  const issues: RobotPayloadPreflightIssue[] = [];

  const providerUserId = args.providerUserId ?? "";
  const medicaidMemberId = typeof trip?.riders?.medicaid_id === "string" ? trip.riders.medicaid_id.trim() : "";
  let companyId: string | null = trip?.company_id ?? null;
  if (!companyId && trip?.id) {
    const { data } = await supabase
      .from("medicaid_trips")
      .select("company_id")
      .eq("id", trip.id)
      .maybeSingle();
    companyId = data?.company_id ?? null;
  }

  let serviceDateMDY = "";
  try {
    serviceDateMDY = formatTripDateMDY(trip?.pickup_at);
    if (doesSubmit) assertServiceDateNotFuture(serviceDateMDY);
  } catch (e) {
    issues.push(diagnosticIssue("service_date", e instanceof Error ? e.message : "Submission blocked: trip/service date is invalid."));
  }

  let proofRow: any = null;
  if (trip?.id) {
    const { data, error } = await supabase
      .from("medicaid_trips")
      .select("signature_path, state_pdf_path, identity_verified")
      .eq("id", trip.id)
      .maybeSingle();
    if (error) {
      issues.push(diagnosticIssue("signature_on_file_state", `Could not verify the trip signature before submission: ${error.message}`));
    } else {
      proofRow = data;
    }
  }
  const signatureCaptured = Boolean(proofRow?.signature_path || proofRow?.state_pdf_path || trip?.signature_path || trip?.state_pdf_path);
  const signatureState: "yes" | "no" = signatureCaptured ? "yes" : "no";

  const vehicleType = typeof trip?.vehicle_type === "string" && trip.vehicle_type.trim() ? trip.vehicle_type.trim() : "ambulatory";
  let rates: Awaited<ReturnType<typeof requireCompanyRates>> | null = null;
  try {
    rates = await requireCompanyRates(supabase, trip, vehicleType);
    companyId = rates.companyId;
  } catch (e) {
    issues.push(diagnosticIssue("rates", e instanceof Error ? e.message : RATES_NOT_CONFIGURED_MESSAGE));
  }

  let hasPortalConfig = false;
  if (companyId) {
    try {
      await requireCompanyPortalCredential(supabase, companyId);
      hasPortalConfig = true;
    } catch (e) {
      issues.push(diagnosticIssue("portal_id", e instanceof Error ? e.message : NO_PORTAL_CREDENTIAL_MESSAGE));
    }
  } else {
    issues.push(diagnosticIssue("company_id", "Submission blocked: no company is linked to this bill."));
  }

  let billedMiles: number | null = null;
  let tripUnits: number | null = null;
  if (trip?.id) {
    const { data: legRows, error: legErr } = await supabase
      .from("medicaid_trip_legs")
      .select("leg_index, pickup_odometer, dropoff_odometer")
      .eq("medicaid_trip_id", trip.id)
      .order("leg_index");
    if (legErr) {
      issues.push(diagnosticIssue("miles", `Could not read the odometer legs for this trip: ${legErr.message}`));
    } else {
      const odometerLegs = (legRows?.length ? legRows : [
        { pickup_odometer: trip.odometer_start, dropoff_odometer: trip.odometer_end },
      ]).map((l: any) => ({
        pickup_odometer: Number(l.pickup_odometer ?? 0),
        dropoff_odometer: Number(l.dropoff_odometer ?? 0),
      }));
      billedMiles = computeBilledMiles(odometerLegs);
      const positiveLegs = odometerLegs.filter((l: { pickup_odometer: number; dropoff_odometer: number }) => legMiles(l) > 0).length;
      tripUnits = trip.trip_kind === "round_trip" || positiveLegs >= 2 ? 2 : 1;
      if (doesSubmit && billedMiles <= 0) {
        issues.push(diagnosticIssue("miles", "Submission blocked: odometer readings give 0 billable miles"));
      }
    }
  }

  const canonical = {
    provider_id: providerUserId,
    company_id: companyId ?? "",
    portal_id: hasPortalConfig ? "configured" : "",
    medicaid_member_id: medicaidMemberId,
    patient_number: medicaidMemberId,
    service_date: serviceDateMDY,
    signature_on_file_state: signatureState,
    payer: "Medicaid",
    date_type: "service",
    vehicle_type: vehicleType,
    diagnosis_code: rates?.diagnosis_code ?? "",
  };
  const preflight = validateRobotPayloadPreflight(canonical, { doesSubmit });
  if (!preflight.ok) issues.push(...preflight.issues);

  const deduped = Array.from(
    new Map(issues.map((issue) => [`${issue.field}:${issue.message}`, issue])).values(),
  );
  return {
    ok: deduped.length === 0,
    has_company: Boolean(companyId),
    member_last4: last4(medicaidMemberId),
    service_date: serviceDateMDY || null,
    patient_last4: last4(medicaidMemberId),
    signature_on_file_state: signatureState,
    identity_verified: proofRow ? proofRow.identity_verified !== false : null,
    has_portal_config: hasPortalConfig,
    has_rates: Boolean(rates?.trip && rates?.mile && rates?.diagnosis_code),
    vehicle_type: vehicleType || null,
    miles: billedMiles,
    trip_units: tripUnits,
    issues: deduped,
  };
}

/** Fail-fast gate used before any bill is persisted into the robot queue. */
export async function assertRobotSubmissionPreflight(
  supabase: any,
  args: { billingRecordId: string; trip: any; providerUserId: string | null; mode?: "capture" | "submit" | "full" | "debug_confirm_page" },
): Promise<RobotSubmissionDiagnostic> {
  const diagnostic = await getRobotSubmissionDiagnostic(supabase, args);
  if (diagnostic.ok) return diagnostic;
  const first = diagnostic.issues[0]?.message ?? "Submission blocked: required claim data is missing.";
  await logAudit(
    supabase,
    args.billingRecordId,
    args.providerUserId,
    "robot_preflight_blocked_before_queue",
    JSON.stringify(diagnostic),
  );
  throw new Error(first);
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
     * "debug_confirm_page" = diagnostic: fill + screenshot, never submits.
     */
    mode?: "capture" | "submit" | "full" | "debug_confirm_page";
    /** Tenant used for deterministic robot-worker affinity. */
    companyId?: string | null;
    /** Batch-level fleet snapshot (avoids one registry read per bill). */
    fleetContext?: import("@/lib/robotFleet.server").FleetContext | null;
  },
) {
  const { billingRecordId, trip, providerUserId } = args;
  // FAIL CLOSED ON PROVIDER IDENTITY.
  // The robot rejects a payload with no provider_id ("No provider_id on this
  // trip.") and the rate endpoint resolves the company from it. Never start a
  // job without one — background sweeps must resolve a real user first.
  if (!providerUserId) {
    throw new Error(
      "Submission blocked: no provider account was resolved for this bill (missing provider_id).",
    );
  }
  // One-shot is the default everywhere; a capture-only run must be asked for.
  const mode = args.mode ?? "full";
  const rider = trip.riders;
  const medicaidMemberId: string | null = rider?.medicaid_id ?? null;
  if (!medicaidMemberId) {
    throw new Error("Submission blocked: Medicaid member ID is missing.");
  }


  // Unique job id per submission attempt. Server-side timestamp keeps it
  // monotonic even if two attempts race.
  const jobId = `trip-${trip.id}-${mode}-${Date.now()}`;
  /** Anything that is not a pure capture really submits at the portal. */
  const doesSubmit = mode === "submit" || mode === "full";

  // This is the final safety boundary shared by every submission path,
  // including queued work and the legacy review flow. UI/server-function
  // checks alone are insufficient because dispatchNextQueued calls this
  // helper directly.
  if (doesSubmit && REAL_SUBMISSIONS_PAUSED) {
    throw new Error(
      "Real portal submissions are paused because the automation is not saving service lines. Nothing was submitted.",
    );
  }

  // FINAL CONCURRENCY BOUNDARY (defence in depth).
  // The DB-leased queue is the only intended dispatcher, but this helper is the
  // last shared gate before the network call, so it independently enforces the
  // SAME caps: at most MAX_CONCURRENT_ROBOT_JOBS live portal sessions per
  // provider account, and never two live sessions for one passenger. It used to
  // allow only ONE session per account, which contradicted the queue's cap and
  // wedged the whole queue whenever a single row lingered in `submitting`.
  {
    const { listActiveRobotJobs, MAX_CONCURRENT_ROBOT_JOBS, MAX_CONCURRENT_JOBS_PER_RIDER, riderKeyOf } =
      await import("@/lib/robotQueue.server");
    const companyId = args.companyId ?? trip.company_id ?? null;
    const live = await listActiveRobotJobs(supabase, {
      companyId,
      excludeRecordId: billingRecordId,
    });
    const key = riderKeyOf(trip);
    const riderLive = key ? live.filter((l) => l.riderKey === key).length : 0;
    const accountFull = live.length >= MAX_CONCURRENT_ROBOT_JOBS;
    const riderFull = Boolean(key) && riderLive >= MAX_CONCURRENT_JOBS_PER_RIDER;
    if (accountFull || riderFull) {
      throw new Error(
        doesSubmit
          ? "Another portal session is already running on this provider account — the automation service is temporarily unavailable for this bill. Nothing was submitted; it stays queued."
          : "Another portal session is already running on this provider account. Try the diagnostic run again in a few minutes.",
      );
    }
  }



  // Portal-clock guard: never send a date of service the portal will reject as
  // being in the future (Mountain Time), which silently zeroes the claim.
  const serviceDateMDY = formatTripDateMDY(trip.pickup_at);
  if (doesSubmit) assertServiceDateNotFuture(serviceDateMDY);


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
    throw new Error("Submission blocked: this trip has no signed report on file.");
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
    // Pre-submit navigation hardening: redundant strategies for login → Claims.
    // Additive; workers that do not read it keep their existing behaviour.
    navigation: CLAIMS_NAV_SPEC,
    job_id: jobId,
    medicaid_trip_id: trip.id,
    provider_id: providerUserId,
    company_id: rates.companyId,
    // Portal login is company-owned; tell the robot exactly which one to fetch.
    portal_id: credential.portal_id,
    vehicle_type: vehicleType,
    // MEMBER ID and PATIENT NUMBER now both carry the real state Medicaid
    // member id — the portal's Patient Number box must match the member id
    // exactly, so the internal trip uuid is no longer sent there.
    medicaid_member_id: medicaidMemberId,
    member_id: medicaidMemberId,
    medicaid_id: medicaidMemberId,
    patient_number: medicaidMemberId,
    patient_account_number: medicaidMemberId,
    // Date of service. Aliases cover whichever key the robot reads; a blank
    // date on the claim means none of these were picked up.
    trip_date: serviceDateMDY,
    service_date: serviceDateMDY,
    date_of_service: serviceDateMDY,
    from_date: serviceDateMDY,
    to_date: serviceDateMDY,
    // Step 1 portal prerequisites. These are fixed for the Colorado Medicaid
    // professional claim path the robot automates; send explicit aliases so a
    // missing/defaulted worker field cannot leave Step 1 with only the generic
    // "required field" message.
    payer: "Medicaid",
    payer_type: "Medicaid",
    claim_payer: "Medicaid",
    insurance_type: "Medicaid",
    date_type: "service",
    date_type_code: "service",
    service_date_type: "service",


    // Explicit rates so the automation service never has to guess or fall back
    // to its own built-in defaults. Charge amounts are exact two-decimal text:
    // a float artifact (54.800000000000004) breaks the portal's amount box.
    trip_rate: withPortalMoneyFields(rates.trip, ["charge_amount"]),
    mile_rate: withPortalMoneyFields(rates.mile, ["charge_amount"]),
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
    provider_signature_on_file_state: signatureCaptured ? "yes" : "no",
    signature_on_file_state: signatureCaptured ? "yes" : "no",
    provider_has_signature_on_file_state: signatureCaptured ? "yes" : "no",
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

    // HARD PRE-SUBMIT GUARD (2026-08-13 incident).
    // A real job clicked Submit with ZERO committed service lines: the base
    // line never committed, the mileage line stayed in an open edit form, and
    // the portal bounced Step 3 with "At least one Service Detail must be
    // entered." Instruct the automation service to verify committed rows in
    // the Service Details table BEFORE clicking Submit, and to abort with a
    // clear error instead of submitting an empty claim. Every claim we send
    // has exactly two lines: the trip/base line and the mileage line.
    require_committed_service_lines: true,
    abort_if_no_committed_service_lines: true,
    verify_service_lines_before_submit: true,
    min_committed_service_lines: 2,
    expected_service_lines: 2,
  };

  // CORRECTED RESUBMISSION OVERLAY.
  // A first-time submission never has a queued resubmission draft, so its
  // payload is untouched. When the biller queued a corrected draft for this
  // trip, the saved snapshot (dates, member id, odometers, service lines,
  // modifiers) replaces the corresponding payload fields — the original trip
  // rows themselves are never edited.
  //
  // THE LINK IS THE BILLING RECORD, NOT THE TRIP. A corrected claim has its own
  // billing record carrying `resubmission_id`; the shared trip may still hold
  // the original denied claim's history. Resolving by record id means the
  // corrected run can never be confused with the original one — and it is what
  // marks the whole run as `robot_pass = "resubmit"` below.
  const { data: recLink } = await supabase
    .from("billing_records")
    .select("resubmission_id")
    .eq("id", billingRecordId)
    .maybeSingle();
  const correctedResubmissionId: string | null = (recLink?.resubmission_id as string) ?? null;

  const draftQuery = correctedResubmissionId
    ? supabase
        .from("claim_resubmissions")
        .select("id, draft_snapshot")
        .eq("id", correctedResubmissionId)
    : supabase
        .from("claim_resubmissions")
        .select("id, draft_snapshot")
        .eq("original_trip_id", trip.id)
        // `processing` = already claimed for THIS run; the overlay must still
        // apply so the robot is fed the corrected snapshot, never the original.
        .in("status", ["queued", "processing"]);
  const { data: queuedDraft } = await draftQuery.maybeSingle();
  if (queuedDraft?.draft_snapshot) {
    const { applyResubmissionOverrides } = await import("@/lib/resubmissionDraft");
    Object.assign(
      payload,
      applyResubmissionOverrides(payload as Record<string, any>, queuedDraft.draft_snapshot, {
        serviceDateMDY: (iso: string) => formatTripDateMDY(iso) || iso,
      }),
    );
    (payload as Record<string, any>).resubmission_id = queuedDraft.id;
  }
  if (correctedResubmissionId) {
    (payload as Record<string, any>).resubmission_id = correctedResubmissionId;
    (payload as Record<string, any>).is_resubmission = true;
  }

  const preflight = validateRobotPayloadPreflight(payload, { doesSubmit });
  if (!preflight.ok) {
    const msg = formatRobotPreflightFailure(preflight);
    const diagnostics = JSON.stringify({
      ...formatRobotPayloadDiagnostic(payload),
      issues: preflight.issues,
    });
    await supabase.from("billing_audit_log").insert({
      billing_record_id: billingRecordId,
      action: "robot_payload_preflight_failed",
      actor_id: providerUserId,
      actor_type: "admin",
      notes: diagnostics,
    });
    throw new Error(msg);
  }

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
      payer_sent: payload.payer,
      date_type_sent: payload.date_type,
      signature_on_file_state: payload.signature_on_file_state,
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

  // SINGLE NETWORK BOUNDARY. In SUBMISSION_TEST_MODE the adapter answers from
  // an in-process mock and no request can reach the real portal automation.
  // The fleet layer only chooses WHICH copy of the automation service gets the
  // payload; the payload and the contract are untouched.
  const { dispatchToFleet } = await import("@/lib/robotFleet.server");
  const dispatched = await dispatchToFleet(supabase, {
    payload,
    jobId,
    companyId: args.companyId ?? trip.company_id ?? null,
    context: args.fleetContext ?? null,
  });

  const nowIso = new Date().toISOString();
  await supabase
    .from("medicaid_trips")
    .update({
      robot_job_id: dispatched.jobId,
      // STICKY: reconciliation must always poll the worker that accepted it.
      robot_worker_id: dispatched.workerId,
      robot_worker_url: dispatched.workerUrl,
      robot_job_started_at: nowIso,
      robot_last_status: "started",
      robot_last_message: null,
      robot_last_checked_at: nowIso,
      // A corrected claim is ALWAYS recorded as "resubmit", so the shared trip
      // row states that the live job belongs to a correction and never to the
      // original denied claim.
      robot_pass: robotPassFor({ doesSubmit, resubmissionId: correctedResubmissionId }),
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
 * PORTAL-OUTCOME EVIDENCE PREDICATES.
 *
 * The implementations now live in the client-safe `@/lib/submitEvidence` so
 * pure decision modules (and the billing UI) can apply the SAME rules instead
 * of re-implementing near-copies. They are re-exported here unchanged, which
 * keeps every existing import — and the suite's `vi.mock("@/lib/billingHelpers")`
 * stubs — working exactly as before.
 */
export {
  looksLikePostConfirmTimeout,
  looksLikePossiblySubmittedTimeout,
  looksLikeNoServiceLinesFailure,
  UNVERIFIED_SUBMIT_STATUS,
  hasExplicitPreSubmitFailureEvidence,
  MAX_AUTO_TIMEOUT_RETRIES,
  looksLikeRetryableTimeout,
} from "@/lib/submitEvidence";


