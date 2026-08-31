import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertBillingOrAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: canBill }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("current_user_can_bill"),
  ]);
  if (!isAdmin && !canBill) throw new Error("Forbidden: billing or admin only");
}

/** Live Auto Pilot status for the button: running, how many left, how many sending. */
export const getAutoPilotStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { data: companyId } = await supabase.rpc("current_user_company_id");
    const { getAutoPilotState } = await import("@/lib/autoPilot.server");
    return await getAutoPilotState(supabase, companyId ?? null);
  });

/**
 * START AUTO PILOT. One press: every eligible bill (or just the selected ones)
 * is put through the normal safe submit path in bounded waves, and the run
 * keeps feeding itself from the background queue tick until nothing is left.
 */
export const startAutoPilotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).max(1000).optional(),
        /**
         * Explicitly selected CORRECTED RESUBMISSIONS. A separate, typed field
         * so a corrected claim can never be confused with an ordinary bill id.
         */
        resubmission_ids: z.array(z.string().uuid()).max(1000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { data: companyId } = await supabase.rpc("current_user_company_id");
    const { startAutoPilot } = await import("@/lib/autoPilot.server");
    return await startAutoPilot(supabase, {
      companyId: companyId ?? null,
      userId,
      scopeIds: data?.ids ?? null,
      resubmissionIds: data?.resubmission_ids ?? null,
    });
  });


/**
 * STOP AUTO PILOT. Stops FEEDING only — bills already handed to the portal keep
 * running and are never cancelled, so no claim can be left in limbo.
 */
export const stopAutoPilotRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { data: companyId } = await supabase.rpc("current_user_company_id");
    const { stopAutoPilot } = await import("@/lib/autoPilot.server");
    return await stopAutoPilot(supabase, companyId ?? null);
  });
