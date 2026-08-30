/**
 * Server functions for the bulk READ-ONLY HCPF reconciliation sweep.
 * None of these submit, resubmit, queue or move a bill between stages.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling } from "@/lib/billingHelpers";
import {
  loadSweepProgress,
  markSweepRowConfirmed,
  runSweepTick,
  setSweepStatus,
  startSweep,
} from "@/lib/reconcileSweep.server";

/** Queue every unreconciled Needs Fix / Verification Hold bill for lookup. */
export const startReconcileSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);
    return startSweep(supabase, { companyId, actorId: userId });
  });

/** Live progress + prioritized results for the progress card. */
export const getReconcileSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);
    return loadSweepProgress(supabase, companyId);
  });

export const setReconcileSweepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ sweep_id: z.string().uuid(), status: z.enum(["running", "paused", "done"]) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return setSweepStatus(supabase, { sweepId: data.sweep_id, status: data.status });
  });

/**
 * Biller confirms a candidate claim id for a bill. The link itself goes
 * through the existing conflict-guarded writer, so a claim already used by
 * another bill is still refused.
 */
export const confirmSweepClaim = createServerFn({ method: "POST" })
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
    const { linkPortalClaim } = await import("@/lib/hcpfVerify.server");
    const out = await linkPortalClaim(supabase, {
      recordId: data.id,
      actorId: userId,
      claimNumber: data.claim_number,
    });
    await markSweepRowConfirmed(supabase, { recordId: data.id, actorId: userId, kind: "linked" });
    return out;
  });

/** Biller confirms the portal really has no claim for this trip. */
export const confirmSweepNoClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), acknowledged: z.literal(true) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { recordVerifiedNoClaim } = await import("@/lib/manualVerification.server");
    const out = await recordVerifiedNoClaim(supabase, {
      recordId: data.id,
      actorId: userId,
      acknowledged: true,
    });
    await markSweepRowConfirmed(supabase, { recordId: data.id, actorId: userId, kind: "no_claim" });
    return out;
  });

/** Manual kick of one sweep tick from the UI (same bounded, leased path). */
export const kickReconcileSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    return runSweepTick(supabase);
  });
