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
  "submitting",
  "submitted",
  "approved",
  "rejected",
  "needs_fix",
]);

export const ALL_STATUSES = [
  "pending_review",
  "approved",
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

  const payload = {
    id: jobId,
    medicaid_trip_id: trip.id,
    provider_id: providerUserId,
    vehicle_type: (trip.vehicle_type as string | null) ?? "ambulatory",
    medicaid_member_id: medicaidMemberId,
    trip_date: formatTripDateMDY(trip.pickup_at),
    // Paper-originated bills have no digital signature row: the physical
    // signature lives on the uploaded paper report stored as state_pdf_path.
    signature_captured: Boolean(trip.signature_path || trip.state_pdf_path),
    // "Did the Driver verify the member's identity?" at the portal. Explicit
    // aliases so the robot reads whichever key it implements.
    identity_verified: trip.identity_verified !== false,
    member_identity_verified: trip.identity_verified !== false,
    pickup_odometer: Number(trip.odometer_start ?? 0),
    dropoff_odometer: Number(trip.odometer_end ?? 0),
    is_round_trip: trip.trip_kind === "round_trip",
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
     id, pickup_at, odometer_start, odometer_end, signature_path,
     vehicle_type, trip_kind, rider_id, robot_captured_claim,
     riders(medicaid_id)
   )`;
