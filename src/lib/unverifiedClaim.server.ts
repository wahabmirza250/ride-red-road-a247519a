/**
 * AUTOMATIC RESOLUTION OF "SUBMITTED_UNVERIFIED" JOBS.
 *
 * Recurring pattern: the robot clicks portal Confirm, the claim IS created,
 * but the page load after the click times out — so the job ends with no claim
 * number and the record is parked as SUBMITTED_UNVERIFIED. Until now a human
 * had to notice, look the claim up in the portal by Medicaid ID / Patient
 * Number, and paste the claim number back in.
 *
 * This module does that lookup automatically:
 *   - it is READ-ONLY (Search Claims). It never submits, adjusts, or resubmits.
 *   - it waits a couple of minutes after the timeout so the portal has settled.
 *   - it retries on the normal background sweep cadence.
 *   - after MAX_LOOKUP_ATTEMPTS it stops and flags the record for a human,
 *     with the exact search terms to use.
 */
import { ROBOT_BASE_URL, denverDateISO, logAudit } from "@/lib/billingHelpers";
import { extractConfirmationNumber } from "@/lib/claimReview";

/** Give the portal time to settle before the first lookup. */
export const FIRST_LOOKUP_DELAY_MS = 2 * 60 * 1000;
/** Minimum spacing between lookups (the portal allows one session at a time). */
export const LOOKUP_INTERVAL_MS = 3 * 60 * 1000;
/** After this many read-only lookups we stop and ask a human. */
export const MAX_LOOKUP_ATTEMPTS = 6;

const LOOKUP_ACTION = "unverified_claim_lookup";

export type UnverifiedResolveResult = {
  /** true = keep checking on the next sweep */
  pending: boolean;
  status: string;
  message: string | null;
  confirmation_number?: string | null;
};

/** MM/DD/YYYY, the format the portal's Search Claims screen expects. */
function portalDate(iso: string | null | undefined): string {
  const d = denverDateISO(iso ?? undefined);
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

/**
 * READ-ONLY portal claim search through the automation service.
 * Returns the claim number when the portal shows a matching claim.
 */
async function searchPortalClaim(args: {
  providerUserId: string;
  companyId: string | null;
  portalId: string | null;
  memberId: string;
  serviceDateISO: string | null;
}): Promise<{
  ok: boolean;
  claim: string | null;
  status: string | null;
  detail: string;
  /** The lookup capability itself is missing/unreachable — nothing was checked. */
  unsupported?: boolean;
}> {
  const serviceDate = portalDate(args.serviceDateISO);
  let res: Response;
  try {
    res = await fetch(`${ROBOT_BASE_URL}/search-claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // READ-ONLY contract. Aliases cover whichever key the robot reads.
        mode: "search_claims",
        read_only: true,
        provider_id: args.providerUserId,
        company_id: args.companyId,
        portal_id: args.portalId,
        member_id: args.memberId,
        medicaid_member_id: args.memberId,
        patient_number: args.memberId,
        patient_account_number: args.memberId,
        service_date: serviceDate,
        from_date: serviceDate,
        to_date: serviceDate,
        close_session: true,
      }),
    });
  } catch (e: any) {
    return {
      ok: false,
      claim: null,
      status: null,
      detail: `lookup unreachable: ${e?.message ?? e}`,
      unsupported: true,
    };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // 404/405/501 means the automation service has no read-only search route at
    // all: no claim was checked. Never report that as "nothing found yet".
    const unsupported = res.status === 404 || res.status === 405 || res.status === 501;
    return {
      ok: false,
      claim: null,
      status: null,
      detail: `lookup HTTP ${res.status}: ${text.slice(0, 200)}`,
      ...(unsupported ? { unsupported: true } : {}),
    };
  }
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, claim: null, status: null, detail: "lookup returned a non-JSON response" };
  }

  const first = Array.isArray(body?.claims) ? body.claims[0] : null;
  const claim = extractConfirmationNumber(body) ?? (first ? extractConfirmationNumber(first) : null);
  const status =
    (typeof body?.claim_status === "string" && body.claim_status) ||
    (first && typeof first.status === "string" ? first.status : null);
  return { ok: true, claim, status, detail: text.slice(0, 200) };
}

/** How many automatic lookups have already run for this record. */
async function attemptCount(supabase: any, recordId: string): Promise<number> {
  const { data } = await supabase
    .from("billing_audit_log")
    .select("id")
    .eq("billing_record_id", recordId)
    .eq("action", LOOKUP_ACTION);
  return (data ?? []).length;
}

/**
 * One automatic resolution pass for a record parked as SUBMITTED_UNVERIFIED.
 * Safe to call repeatedly; it self-throttles and never submits anything.
 */
export async function resolveUnverifiedClaim(
  supabase: any,
  recordId: string,
  actorId: string | null,
): Promise<UnverifiedResolveResult> {
  const { data: rec, error } = await supabase
    .from("billing_records")
    .select(
      `id, status, trip_id, company_id,
       medicaid_trips!inner(
         id, company_id, pickup_at, rider_id, robot_last_status, robot_last_checked_at,
         robot_job_started_at, robot_confirmation_number, submitted_confirmation,
         riders(medicaid_id, full_name)
       )`,
    )
    .eq("id", recordId)
    .single();
  if (error) throw new Error(error.message);

  const trip: any = rec.medicaid_trips;
  const known = trip?.robot_confirmation_number ?? trip?.submitted_confirmation ?? null;
  if (known) {
    return { pending: false, status: "submitted", message: `Already resolved — claim #${known}`, confirmation_number: known };
  }

  // Throttle: wait for the portal to settle, then space attempts out.
  const attempts = await attemptCount(supabase, recordId);
  const since = new Date(trip?.robot_last_checked_at ?? trip?.robot_job_started_at ?? 0).getTime();
  const waitFor = attempts === 0 ? FIRST_LOOKUP_DELAY_MS : LOOKUP_INTERVAL_MS;
  if (since && Date.now() - since < waitFor) {
    return { pending: true, status: "SUBMITTED_UNVERIFIED", message: "Waiting before the next portal lookup." };
  }

  const memberId = String(trip?.riders?.medicaid_id ?? "").trim();
  const nowIso = new Date().toISOString();

  if (!memberId) {
    const msg =
      "Automatic portal lookup cannot run: this trip has no Medicaid Member ID on file. " +
      "Search the portal manually before doing anything else — do NOT resubmit.";
    await flagForHuman(supabase, rec.id, trip.id, actorId, msg, nowIso);
    return { pending: false, status: "NEEDS_HUMAN_LOOKUP", message: msg };
  }

  let portalId: string | null = null;
  try {
    const { requireCompanyPortalCredential } = await import("@/lib/billingHelpers");
    const cred = await requireCompanyPortalCredential(supabase, trip.company_id ?? rec.company_id);
    portalId = cred.portal_id;
  } catch {
    portalId = null;
  }

  const { resolveProviderUserId } = await import("@/lib/robotQueue.server");
  const found = await searchPortalClaim({
    providerUserId: await resolveProviderUserId(supabase, {
      actorId,
      trip,
      companyId: trip.company_id ?? rec.company_id ?? null,
    }),
    companyId: trip.company_id ?? rec.company_id ?? null,
    portalId,
    memberId,
    serviceDateISO: trip.pickup_at ?? null,
  });

  const attemptNo = attempts + 1;
  await logAudit(
    supabase,
    rec.id,
    actorId,
    LOOKUP_ACTION,
    `Read-only portal claim search #${attemptNo} for member ${memberId} on ${portalDate(trip.pickup_at)} — ${
      found.claim ? `claim ${found.claim}` : found.ok ? "no matching claim yet" : found.detail
    }`,
  );

  if (found.claim) {
    const message = `Resolved automatically by a read-only portal search: claim #${found.claim}${
      found.status ? ` (portal status ${found.status})` : ""
    }. Nothing was resubmitted.`;
    await supabase
      .from("medicaid_trips")
      .update({
        status: "submitted",
        robot_last_status: "SUBMITTED",
        robot_last_message: message,
        robot_last_checked_at: nowIso,
        robot_confirmation_number: found.claim,
        submitted_confirmation: found.claim,
        portal_confirmation: found.claim,
        portal_status: "submitted",
        portal_submitted_at: nowIso,
        submitted_at: nowIso,
        submitted_by: actorId,
      })
      .eq("id", trip.id);
    await supabase
      .from("billing_records")
      .update({
        status: "submitted",
        state_confirmation_number: found.claim,
        submitted_at: nowIso,
        submission_error: null,
        requires_human_step: false,
      })
      .eq("id", rec.id);
    await logAudit(supabase, rec.id, actorId, "robot_submit_resolved_by_lookup", message);
    return { pending: false, status: "submitted", message, confirmation_number: found.claim };
  }

  if (attemptNo < MAX_LOOKUP_ATTEMPTS) {
    const msg =
      `The Confirm click landed but the page timed out, so the claim number is unknown. ` +
      `Automatic read-only portal search ${attemptNo}/${MAX_LOOKUP_ATTEMPTS} found nothing yet — still checking. Do NOT resubmit.`;
    await supabase
      .from("medicaid_trips")
      .update({ robot_last_message: msg, robot_last_checked_at: nowIso })
      .eq("id", trip.id);
    await supabase
      .from("billing_records")
      .update({ submission_error: msg, requires_human_step: false })
      .eq("id", rec.id);
    return { pending: true, status: "SUBMITTED_UNVERIFIED", message: msg };
  }

  const msg =
    `NEEDS HUMAN REVIEW: the Confirm click landed, so a claim was most likely created, but ` +
    `${MAX_LOOKUP_ATTEMPTS} automatic read-only portal searches did not find it. ` +
    `Search the portal manually (Claims → Search Claims) for member ${memberId} on ${portalDate(trip.pickup_at)} ` +
    `and record the claim number here. Do NOT resubmit until you have checked.`;
  await flagForHuman(supabase, rec.id, trip.id, actorId, msg, nowIso);
  return { pending: false, status: "NEEDS_HUMAN_LOOKUP", message: msg };
}

async function flagForHuman(
  supabase: any,
  recordId: string,
  tripId: string,
  actorId: string | null,
  msg: string,
  nowIso: string,
) {
  await supabase
    .from("medicaid_trips")
    .update({
      robot_last_status: "NEEDS_HUMAN_LOOKUP",
      robot_last_message: msg,
      robot_last_checked_at: nowIso,
    })
    .eq("id", tripId);
  await supabase
    .from("billing_records")
    .update({ submission_error: msg, requires_human_step: true })
    .eq("id", recordId);
  await logAudit(supabase, recordId, actorId, "unverified_claim_needs_human", msg);
}
