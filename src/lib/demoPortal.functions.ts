import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling } from "./billingHelpers";
export const simulateDemoPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200).optional(), action: z.enum(["submit", "payment"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertBilling(context.supabase, context.userId);
    const { demoPortalCompany, runDemoPortal } = await import("./demoPortal.server");
    const companyId = await demoPortalCompany(context.userId);
    if (!companyId) throw new Error("This action is only available in the demo company.");
    return runDemoPortal(context.supabase, companyId, data.ids, data.action);
  });
