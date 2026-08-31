/**
 * Server side of the "Verify HCPF claim" panel.
 *
 * Everything here is read-only against the portal. The only writes are:
 *   - linking a confirmed claim number to THIS bill (reuses the existing
 *     manual-verification writer, so audit history and evidence are kept), and
 *   - audit-log entries.
 * Nothing here ever enqueues, submits or resubmits a bill.
 */
import { logAudit, requireCompanyPortalCredential } from "@/lib/billingHelpers";
import {
  claimConflictError,
  decideLink,
  friendlyLinkError,
  type HcpfSearchResult,
  type LinkDecision,
} from "@/lib/hcpfSearch";
import {
  findLinkedBills,
  portalDateMDY,
  sameDayTripCount,
  searchHcpfForRecord,
} from "@/lib/hcpfSearch.server";
import { recordVerifiedClaimFound } from "@/lib/manualVerification.server";

const RECORD_SELECT = `id, status, trip_id, company_id, requires_human_step,
  submission_error, submit_last_error, failure_code, state_confirmation_number, submit_account_key,
  medicaid_trips(
    id, pickup_at, rider_id, company_id, odometer_start, odometer_end, miles,
    robot_job_id, robot_last_status, robot_last_message,
    robot_confirmation_number, submitted_confirmation,
    riders(full_name, medicaid_id)
  )`;

async function load(supabase: any, id: string) {
  const { data, error } = await supabase
    .from("billing_records")
    .select(RECORD_SELECT)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return { rec: data as any, trip: (data as any).medicaid_trips as any };
}

export type VerificationContext = {
  record_id: string;
  trip_id: string | null;
  medicaid_id: string;
  passenger_name: string;
  service_date_iso: string | null;
  service_date: string;
  odometer_start: number | null;
  odometer_end: number | null;
  miles: number | null;
  units: number | null;
  provider_account: string;
  robot_job_id: string;
  same_day_trip_count: number;
};

export async function loadVerificationContext(
  supabase: any,
  id: string,
): Promise<VerificationContext> {
  const { rec, trip } = await load(supabase, id);
  const count = await sameDayTripCount(supabase, {
    companyId: trip?.company_id ?? rec.company_id ?? null,
    riderId: trip?.rider_id ?? null,
    serviceDateISO: trip?.pickup_at ?? null,
  });
  return {
    record_id: rec.id,
    trip_id: rec.trip_id ?? null,
    medicaid_id: String(trip?.riders?.medicaid_id ?? "").trim(),
    passenger_name: String(trip?.riders?.full_name ?? "").trim(),
    service_date_iso: trip?.pickup_at ?? null,
    service_date: portalDateMDY(trip?.pickup_at ?? null),
    odometer_start: trip?.odometer_start ?? null,
    odometer_end: trip?.odometer_end ?? null,
    miles: trip?.miles ?? null,
    units: null,
    provider_account: String(rec.submit_account_key ?? "").trim(),
    robot_job_id: String(trip?.robot_job_id ?? "").trim(),
    same_day_trip_count: count,
  };
}

export async function runHcpfSearch(
  supabase: any,
  id: string,
  actorId: string,
): Promise<HcpfSearchResult & { decision: LinkDecision; same_day_trip_count: number }> {
  const { rec, trip } = await load(supabase, id);
  const companyId = trip?.company_id ?? rec.company_id ?? null;

  let portalId: string | null = null;
  try {
    const cred = await requireCompanyPortalCredential(supabase, companyId);
    portalId = cred.portal_id;
  } catch {
    portalId = null;
  }

  const { resolveProviderUserId } = await import("@/lib/robotQueue.server");
  const providerUserId = await resolveProviderUserId(supabase, {
    actorId,
    trip,
    companyId,
  });

  const result = await searchHcpfForRecord(supabase, {
    recordId: id,
    actorId,
    companyId,
    portalId,
    providerUserId,
    memberId: String(trip?.riders?.medicaid_id ?? "").trim(),
    serviceDateISO: trip?.pickup_at ?? null,
    tripId: rec.trip_id ?? trip?.id ?? null,
  });

  const count = await sameDayTripCount(supabase, {
    companyId,
    riderId: trip?.rider_id ?? null,
    serviceDateISO: trip?.pickup_at ?? null,
  });

  return {
    ...result,
    same_day_trip_count: count,
    decision: decideLink({ claims: result.claims, sameDayTripCount: count }),
  };
}

/**
 * Link a claim number to this bill. If the number already belongs to another
 * RedArt bill, NOTHING is written and a structured conflict is thrown so the
 * UI can show a friendly card instead of a database error.
 */
export async function linkPortalClaim(
  supabase: any,
  args: { recordId: string; actorId: string; claimNumber: string },
) {
  const claim = args.claimNumber.trim();
  const { rec, trip } = await load(supabase, args.recordId);
  const companyId = trip?.company_id ?? rec.company_id ?? null;

  const linked = await findLinkedBills(supabase, companyId, [claim]);
  const existing = linked.get(claim);
  if (existing && existing.billing_record_id !== args.recordId) {
    await logAudit(
      supabase,
      args.recordId,
      args.actorId,
      "hcpf_claim_conflict",
      `Attempt to link claim #${claim} was refused: it is already linked to billing record ${existing.billing_record_id} (trip ${existing.trip_id ?? "—"}). Nothing was written.`,
    );
    throw claimConflictError(existing, claim);
  }

  try {
    const out = await recordVerifiedClaimFound(supabase, {
      recordId: args.recordId,
      actorId: args.actorId,
      claimNumber: claim,
      acknowledged: true,
    });
    await logAudit(
      supabase,
      args.recordId,
      args.actorId,
      "hcpf_claim_linked",
      `Biller linked HCPF claim #${claim} to this bill after a portal check. Nothing was submitted.`,
    );
    return out;
  } catch (e: any) {
    const friendly = friendlyLinkError(e);
    // A late unique-constraint hit means another bill won the race.
    const late = await findLinkedBills(supabase, companyId, [claim]);
    const other = late.get(claim);
    if (other && other.billing_record_id !== args.recordId) throw claimConflictError(other, claim);
    throw new Error(friendly);
  }
}

export async function recordKeepOnHold(
  supabase: any,
  args: { recordId: string; actorId: string; note?: string },
) {
  await logAudit(
    supabase,
    args.recordId,
    args.actorId,
    "hcpf_keep_on_hold",
    `Biller chose to keep this bill on verification hold.${args.note ? ` Note: ${args.note}` : ""} Nothing was submitted, queued or changed.`,
  );
  return { ok: true as const, status: "on_hold" as const };
}
