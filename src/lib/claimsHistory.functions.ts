import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClaimHistoryRow = {
  id: string;
  claim_id: string | null;
  member_name: string | null;
  medicaid_id: string | null;
  trip_date: string | null;
  submitted_at: string | null;
  total_amount: number | null;
  total_source: "captured" | "billing_records" | null;
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
    // Billing staff own this audit trail day-to-day; admins can see it too.
    const [{ data: isAdmin }, { data: isBilling }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
    ]);
    if (!isAdmin && !isBilling) throw new Error("Forbidden: billing or admin only");

    const { data, error } = await supabase
      .from("medicaid_trips")
      .select(
        "id, status, pickup_at, submitted_at, portal_submitted_at, submitted_confirmation, portal_confirmation, robot_confirmation_number, robot_captured_claim, dispatch_trip_id, riders(full_name, medicaid_id)",
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

    return rows.map((r) => {
      const capturedRaw = r.robot_captured_claim?.total_charged_amount;
      const captured =
        capturedRaw == null || capturedRaw === ""
          ? null
          : Number(String(capturedRaw).replace(/[$,]/g, ""));
      const fallback = r.dispatch_trip_id ? totalsByTrip.get(r.dispatch_trip_id) ?? null : null;
      const total = captured != null && Number.isFinite(captured) ? captured : fallback;
      return {
        id: r.id,
        claim_id:
          r.robot_confirmation_number ?? r.submitted_confirmation ?? r.portal_confirmation ?? null,
        member_name: r.riders?.full_name ?? null,
        medicaid_id: r.riders?.medicaid_id ?? null,
        trip_date: r.pickup_at ?? null,
        submitted_at: r.submitted_at ?? r.portal_submitted_at ?? null,
        total_amount: total ?? null,
        total_source: captured != null && Number.isFinite(captured)
          ? ("captured" as const)
          : fallback != null
            ? ("billing_records" as const)
            : null,
      };
    });
  });
