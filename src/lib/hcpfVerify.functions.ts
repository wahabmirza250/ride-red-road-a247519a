import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling } from "@/lib/billingHelpers";
import {
  linkPortalClaim,
  loadVerificationContext,
  recordKeepOnHold,
  runHcpfSearch,
} from "@/lib/hcpfVerify.server";

/** Read-only portal search for one held bill. Never enqueues or submits. */
export const searchHcpfClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return runHcpfSearch(supabase, data.id, userId);
  });

/** Evidence shown in the Verify HCPF claim panel. */
export const getVerificationContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return loadVerificationContext(supabase, data.id);
  });

/** Attach a portal claim number to THIS bill, or refuse with a conflict card. */
export const linkHcpfClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        claim_number: z.string().trim().min(1).max(120),
        acknowledged: z.literal(true),
        confirmed_twice: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return linkPortalClaim(supabase, {
      recordId: data.id,
      actorId: userId,
      claimNumber: data.claim_number,
    });
  });

/** Explicitly keep the bill on hold, with an audit trail. */
export const keepVerificationHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return recordKeepOnHold(supabase, {
      recordId: data.id,
      actorId: userId,
      ...(data.note ? { note: data.note } : {}),
    });
  });
