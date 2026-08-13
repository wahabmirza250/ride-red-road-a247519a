import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export type ClaimHistoryRow = {
  id: string;
  claim_id: string | null;
  member_name: string | null;
  medicaid_id: string | null;
  trip_date: string | null;
  submitted_at: string | null;
  total_amount: number | null;
  total_source: "captured" | "calculated" | "billing_records" | null;
  status: string | null;
};



async function assertBillingOrAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isBilling }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
  ]);
  if (!isAdmin && !isBilling) throw new Error("Forbidden: billing or admin only");
  return { isAdmin, isBilling };
}


/**
 * Permanent billing audit trail: every medicaid trip that reached the portal.
 * Total comes from the robot's captured claim when present, otherwise from the
 * trip's billing line items.
 */
export const listClaimsHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClaimHistoryRow[]> => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { computeClaimTotals } = await import("@/lib/claimAmount.server");

    const { data, error } = await supabase

      .from("medicaid_trips")
      .select(
        "id, status, company_id, vehicle_type, odometer_start, odometer_end, pickup_at, submitted_at, portal_submitted_at, submitted_confirmation, portal_confirmation, portal_status, robot_last_status, robot_confirmation_number, robot_captured_claim, dispatch_trip_id, riders(full_name, medicaid_id), medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
      )
      .or(
        "status.eq.submitted,robot_confirmation_number.not.is.null,submitted_confirmation.not.is.null",
      )
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const dispatchIds = rows.map((r) => r.dispatch_trip_id).filter(Boolean) as string[];

    const totalsByTrip = new Map<string, number>();
    if (dispatchIds.length) {
      const { data: br } = await supabase
        .from("trip_billing_records")
        .select("trip_id, amount")
        .in("trip_id", dispatchIds);
      for (const r of (br ?? []) as any[]) {
        totalsByTrip.set(r.trip_id, (totalsByTrip.get(r.trip_id) ?? 0) + Number(r.amount ?? 0));
      }
    }

    // Current billing status per trip (paid / submitted / rejected …).
    const statusByTrip = new Map<string, string>();
    if (rows.length) {
      const { data: recs } = await supabase
        .from("billing_records")
        .select("trip_id, status, updated_at")
        .in("trip_id", rows.map((r) => r.id));
      for (const r of (recs ?? []) as any[]) statusByTrip.set(r.trip_id, r.status);
    }

    const computed = await computeClaimTotals(supabase, rows);

    return rows.map((r) => {
      const calc = computed.get(r.id);
      const fallback = r.dispatch_trip_id ? totalsByTrip.get(r.dispatch_trip_id) ?? null : null;
      const total = calc?.amount ?? fallback;
      return {
        id: r.id,
        claim_id:
          r.robot_confirmation_number ?? r.submitted_confirmation ?? r.portal_confirmation ?? null,
        member_name: r.riders?.full_name ?? null,
        medicaid_id: r.riders?.medicaid_id ?? null,
        trip_date: r.pickup_at ?? null,
        submitted_at: r.submitted_at ?? r.portal_submitted_at ?? null,
        total_amount: total ?? null,
        total_source: calc?.amount != null ? calc.source : fallback != null ? "billing_records" : null,
        status:
          statusByTrip.get(r.id) ??
          r.portal_status ??
          r.robot_last_status ??
          r.status ??
          null,
      };
    });
  });


/**
 * Reset every submitted claim back to the billing workflow so it can be re-submitted.
 * This clears the visible Claims History entries and the associated confirmation data.
 */
export const clearClaimsHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    const now = new Date().toISOString();

    const { data: trips, error: findErr } = await supabase
      .from("medicaid_trips")
      .select("id")
      .eq("status", "submitted");
    if (findErr) throw new Error(findErr.message);

    const ids = (trips ?? []).map((t: any) => t.id as string);
    if (!ids.length) return { cleared: 0 };

    const { error: tripErr } = await supabase
      .from("medicaid_trips")
      .update({
        status: "approved",
        submitted_at: null,
        submitted_by: null,
        submitted_confirmation: null,
        portal_submitted_at: null,
        portal_confirmation: null,
        robot_confirmation_number: null,
        robot_captured_claim: null,
        robot_captured_at: null,
        review_notes: "Cleared from claims history by billing staff.",
        updated_at: now,
      })
      .in("id", ids);
    if (tripErr) throw new Error(tripErr.message);

    const { error: recErr } = await supabase
      .from("billing_records")
      .update({
        status: "approved",
        submitted_at: null,
        state_confirmation_number: null,
        submission_error: null,
        updated_at: now,
      })
      .in("trip_id", ids);
    if (recErr) throw new Error(recErr.message);

    return { cleared: ids.length };
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
      .object({ tripId: z.string().uuid(), status: z.enum(CLAIM_STATUS_OPTIONS) })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    const { data: rec, error: findErr } = await supabase
      .from("billing_records")
      .select("id, status")
      .eq("trip_id", data.tripId)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!rec) throw new Error("No billing record exists for this claim yet.");

    const from = rec.status as string | null;
    if (from === data.status) return { ok: true, from, to: data.status };

    const { error: upErr } = await supabase
      .from("billing_records")
      .update({ status: data.status, updated_at: new Date().toISOString() })
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
