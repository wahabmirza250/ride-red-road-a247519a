import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dedupeClaimHistory, type ClaimHistoryRow } from "@/lib/claimsHistory";

export type { ClaimHistoryRow } from "@/lib/claimsHistory";

/** Statuses a biller can record manually from what the real portal shows. */
export const CLAIM_STATUS_OPTIONS = [
  "submitted",
  "paid",
  "approved",
  "suspended",
  "rejected",
  "denied",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUS_OPTIONS)[number];

/** Only these count as real, earned income. */
export const PAID_CLAIM_STATUSES: string[] = ["paid"];

async function assertBillingOrAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isBilling }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
  ]);
  if (!isAdmin && !isBilling) throw new Error("Forbidden: billing or admin only");
  return { isAdmin, isBilling };
}

const TRIP_SELECT =
  "id, status, company_id, vehicle_type, odometer_start, odometer_end, pickup_at, submitted_at, " +
  "portal_submitted_at, submitted_confirmation, portal_confirmation, portal_status, robot_last_status, " +
  "robot_confirmation_number, robot_captured_claim, dispatch_trip_id, riders(full_name, medicaid_id), " +
  "medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)";

const RECORD_SELECT =
  "id, trip_id, company_id, status, state_confirmation_number, submitted_at, portal_status_raw, " +
  "portal_charged_amount, portal_allowed_amount, portal_paid_amount, portal_paid_at, " +
  `medicaid_trips!inner(${TRIP_SELECT})`;

/**
 * Permanent billing audit trail — ONE list, three sources:
 *
 *   1. automated claims held on `billing_records` (the robot writes the portal
 *      claim number there; this is where every automated claim actually lives),
 *   2. `medicaid_trips` that reached the portal but predate / bypass the
 *      billing record (legacy rows),
 *   3. `manual_claim_records` entered by a biller by hand.
 *
 * Rows are deduplicated on company + claim number so the same claim never shows
 * twice, and an exact claim-number search finds it in whichever source holds it.
 */
export const listClaimsHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ search: z.string().trim().max(120).optional() }).catch({}).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<ClaimHistoryRow[]> => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { computeClaimTotals } = await import("@/lib/claimAmount.server");

    const term = (data?.search ?? "").trim();

    /* ---------- 1. automated claims (billing_records) ---------- */
    let recQ = supabase
      .from("billing_records")
      .select(RECORD_SELECT)
      .not("state_confirmation_number", "is", null)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (term) recQ = recQ.eq("state_confirmation_number", term);
    const { data: recData, error: recErr } = await recQ;
    if (recErr) throw new Error(recErr.message);

    /* ---------- 2. legacy / portal-only trips ---------- */
    let tripQ = supabase
      .from("medicaid_trips")
      .select(TRIP_SELECT)
      .or(
        "status.eq.submitted,robot_confirmation_number.not.is.null,submitted_confirmation.not.is.null",
      )
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (term)
      tripQ = tripQ.or(
        `robot_confirmation_number.eq.${term},submitted_confirmation.eq.${term},portal_confirmation.eq.${term}`,
      );
    const { data: tripData, error: tripErr } = await tripQ;
    if (tripErr) throw new Error(tripErr.message);

    const recRows = (recData ?? []) as any[];
    const tripRows = (tripData ?? []) as any[];

    const tripsForTotals = [
      ...recRows.map((r) => r.medicaid_trips).filter(Boolean),
      ...tripRows,
    ];
    const seenTrip = new Map<string, any>();
    for (const t of tripsForTotals) if (t?.id && !seenTrip.has(t.id)) seenTrip.set(t.id, t);
    const computed = await computeClaimTotals(supabase, Array.from(seenTrip.values()));

    // Line-item fallback for trips with no captured/calculated amount.
    const dispatchIds = Array.from(seenTrip.values())
      .map((t) => t.dispatch_trip_id)
      .filter(Boolean) as string[];
    const totalsByDispatch = new Map<string, number>();
    if (dispatchIds.length) {
      const { selectIn } = await import("@/lib/dbChunk");
      const br = await selectIn<any>(
        supabase,
        "trip_billing_records",
        "trip_id, amount",
        "trip_id",
        dispatchIds,
      );
      for (const r of br)
        totalsByDispatch.set(r.trip_id, (totalsByDispatch.get(r.trip_id) ?? 0) + Number(r.amount ?? 0));
    }

    const statusByTrip = new Map<string, string>();
    for (const r of recRows) statusByTrip.set(r.trip_id, r.status);
    if (tripRows.length) {
      const { selectIn } = await import("@/lib/dbChunk");
      const recs = await selectIn<any>(
        supabase,
        "billing_records",
        "trip_id, status",
        "trip_id",
        tripRows.map((r) => r.id),
      );
      for (const r of recs) if (!statusByTrip.has(r.trip_id)) statusByTrip.set(r.trip_id, r.status);
    }

    const rowFor = (trip: any, rec: any | null): ClaimHistoryRow => {
      const calc = computed.get(trip.id);
      const fallback = trip.dispatch_trip_id
        ? totalsByDispatch.get(trip.dispatch_trip_id) ?? null
        : null;
      const estimated = calc?.amount ?? fallback;
      return {
        id: trip.id,
        record_id: rec?.id ?? null,
        company_id: rec?.company_id ?? trip.company_id ?? null,
        source: "portal",
        claim_id:
          rec?.state_confirmation_number ??
          trip.robot_confirmation_number ??
          trip.submitted_confirmation ??
          trip.portal_confirmation ??
          null,
        member_name: trip.riders?.full_name ?? null,
        medicaid_id: trip.riders?.medicaid_id ?? null,
        trip_date: trip.pickup_at ?? null,
        submitted_at: rec?.submitted_at ?? trip.submitted_at ?? trip.portal_submitted_at ?? null,
        total_amount: estimated ?? null,
        total_source:
          calc?.amount != null ? calc.source : fallback != null ? "billing_records" : null,
        portal_charged_amount: rec?.portal_charged_amount ?? null,
        portal_allowed_amount: rec?.portal_allowed_amount ?? null,
        portal_paid_amount: rec?.portal_paid_amount ?? null,
        portal_paid_at: rec?.portal_paid_at ?? null,
        status:
          rec?.status ??
          statusByTrip.get(trip.id) ??
          trip.portal_status ??
          trip.robot_last_status ??
          trip.status ??
          null,
      };
    };

    const rows: ClaimHistoryRow[] = [
      ...recRows.map((r) => rowFor(r.medicaid_trips, r)),
      ...tripRows.map((t) => rowFor(t, null)),
    ];

    return dedupeClaimHistory(rows);
  });

/**
 * Legacy "clear history" action.
 *
 * Confirmation numbers are permanent evidence: erasing one would let the same
 * trip be billed to HCPF twice. The action therefore only ever reports what it
 * refuses to touch — the database enforces the same rule with a trigger.
 */
export const clearClaimsHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { count } = await supabase
      .from("billing_records")
      .select("id", { count: "exact", head: true })
      .not("state_confirmation_number", "is", null);
    throw new Error(
      `Claims history is a permanent audit trail. ${count ?? 0} claim(s) hold a real HCPF ` +
        "confirmation number and can never be cleared or resubmitted.",
    );
  });

/**
 * Manual status override: the biller records what the real portal shows for a
 * claim (paid / suspended / denied …). Written to billing_records.status and
 * logged in the billing audit trail.
 */
export const setClaimStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tripId: z.string().uuid(),
        status: z.enum(CLAIM_STATUS_OPTIONS),
        portal_charged_amount: z.number().nullable().optional(),
        portal_allowed_amount: z.number().nullable().optional(),
        portal_paid_amount: z.number().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    const { data: rec, error: findErr } = await supabase
      .from("billing_records")
      .select("id, status")
      .eq("trip_id", data.tripId)
      .is("resubmission_id", null)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!rec) throw new Error("No billing record exists for this claim yet.");

    const from = rec.status as string | null;
    const money: Record<string, unknown> = {};
    if (data.portal_charged_amount !== undefined)
      money["portal_charged_amount"] = data.portal_charged_amount;
    if (data.portal_allowed_amount !== undefined)
      money["portal_allowed_amount"] = data.portal_allowed_amount;
    if (data.portal_paid_amount !== undefined) {
      money["portal_paid_amount"] = data.portal_paid_amount;
      money["portal_paid_at"] =
        data.portal_paid_amount != null && data.status === "paid" ? new Date().toISOString() : null;
    }
    if (from === data.status && !Object.keys(money).length)
      return { ok: true, from, to: data.status };

    const { error: upErr } = await supabase
      .from("billing_records")
      .update({ status: data.status, ...money, updated_at: new Date().toISOString() })
      .eq("id", rec.id);
    if (upErr) throw new Error(upErr.message);

    await supabase.from("billing_audit_log").insert({
      billing_record_id: rec.id,
      action: "manual_status_override",
      actor_id: userId,
      actor_type: "user",
      notes: `Status manually changed from ${from ?? "unknown"} to ${data.status}.`,
    });

    return { ok: true, from, to: data.status };
  });
