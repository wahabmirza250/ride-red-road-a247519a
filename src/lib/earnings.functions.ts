import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CompanyEarnings } from "@/lib/earnings";

/**
 * Billed totals for the caller's OWN company only. Tenant isolation is enforced
 * server-side from the caller's profile — never from a client-supplied id.
 */
export const getCompanyEarnings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyEarnings> => {
    const { userId } = context as { userId: string };
    const { requireCompanyId } = await import("@/lib/company.server");
    const { requireStaff } = await import("@/lib/staffGuard.server");
    const { aggregateEarnings } = await import("@/lib/earnings");

    await requireStaff(userId, ["admin"]);
    const companyId = await requireCompanyId(userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeClaimTotals } = await import("@/lib/claimAmount.server");
    const { selectIn, selectAllPages } = await import("@/lib/dbChunk");

    // Paged: a company with >1000 claims used to silently lose everything past
    // the first page, so newer paid claims never showed up in Earnings.
    const rows = (await selectAllPages<any>(() =>
      supabaseAdmin
        .from("medicaid_trips")
        .select(
          "id, company_id, vehicle_type, odometer_start, odometer_end, robot_captured_claim, submitted_at, portal_submitted_at, updated_at, status, robot_confirmation_number, submitted_confirmation, medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
        )
        .eq("company_id", companyId)
        .or(
          "status.eq.submitted,robot_confirmation_number.not.is.null,submitted_confirmation.not.is.null",
        )
        .order("id", { ascending: true }),
    )) as any[];

    const totals = await computeClaimTotals(supabaseAdmin, rows);

    // Current billing status per trip — only "paid" counts as earned income.
    // Chunked: one huge `in(...)` filter exceeded the request URL limit and
    // returned nothing, which made every paid claim look unpaid ($0 earned).
    const statusByTrip = new Map<string, string>();
    const recs = await selectIn<any>(
      supabaseAdmin,
      "billing_records",
      "trip_id, status",
      "trip_id",
      rows.map((r) => r.id),
    );
    for (const r of recs) statusByTrip.set(r.trip_id, r.status);

    return aggregateEarnings(
      rows.map((r) => ({
        ...r,
        amount: totals.get(r.id)?.amount ?? null,
        billing_status: statusByTrip.get(r.id) ?? null,
      })),
    );
  });


