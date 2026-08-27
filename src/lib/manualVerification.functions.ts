import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling } from "@/lib/billingHelpers";
import {
  recordVerifiedClaimFound,
  recordVerifiedNoClaim,
} from "@/lib/manualVerification.server";

/** (A) A claim WAS found at HCPF — reconcile this bill with its Claim ID. */
export const verifyClaimFound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        claim_number: z.string().trim().min(1).max(120),
        acknowledged: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return recordVerifiedClaimFound(supabase, {
      recordId: data.id,
      actorId: userId,
      claimNumber: data.claim_number,
      acknowledged: data.acknowledged,
    });
  });

/** (B) NO claim was found at HCPF — verified-not-submitted, safe to resubmit. */
export const verifyNoClaimFound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        acknowledged: z.literal(true),
        note: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return recordVerifiedNoClaim(supabase, {
      recordId: data.id,
      actorId: userId,
      acknowledged: data.acknowledged,
      ...(data.note ? { note: data.note } : {}),
    });
  });
