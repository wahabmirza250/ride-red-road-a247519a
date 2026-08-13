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
    const { data, error } = await supabaseAdmin
      .from("medicaid_trips")
      .select(
        "id, company_id, vehicle_type, odometer_start, odometer_end, robot_captured_claim, submitted_at, portal_submitted_at, updated_at, status, robot_confirmation_number, submitted_confirmation, medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
      )
      .eq("company_id", companyId)
      .or(
        "status.eq.submitted,robot_confirmation_number.not.is.null,submitted_confirmation.not.is.null",
      );
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const totals = await computeClaimTotals(supabaseAdmin, rows);
    return aggregateEarnings(
      rows.map((r) => ({ ...r, amount: totals.get(r.id)?.amount ?? null })),
    );
  });

