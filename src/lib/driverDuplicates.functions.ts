import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findDuplicateDriverGroups, type DriverIdentity } from "@/lib/driverDuplicates";

/** Duplicate review and merging is an ADMIN action on the admin's own company. */
async function assertAdmin(supabase: any, userId: string): Promise<string> {
  const [{ data: role }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    supabase.from("profiles").select("company_id").eq("id", userId).maybeSingle(),
  ]);
  if (!role) throw new Error("Admin only");
  const companyId = (profile?.company_id as string | null) ?? null;
  if (!companyId) throw new Error("Your account is not attached to a company");
  return companyId;
}

/** READ-ONLY: likely duplicate driver profiles in the admin's company. */
export const listDuplicateDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await assertAdmin(supabase, userId);

    const { data: drivers, error } = await supabase
      .from("drivers")
      .select("id, user_id, company_id, created_at, total_trips")
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);

    const userIds = (drivers ?? []).map((d: any) => d.user_id).filter(Boolean) as string[];
    const { data: profiles } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, phone")
          .in("id", userIds)
      : { data: [] as any[] };
    const pOf = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const identities: DriverIdentity[] = (drivers ?? []).map((d: any) => {
      const p = d.user_id ? pOf.get(d.user_id) : null;
      return {
        id: d.id,
        user_id: d.user_id ?? null,
        company_id: d.company_id ?? null,
        created_at: d.created_at ?? null,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        first_name: p?.first_name ?? null,
        last_name: p?.last_name ?? null,
        activity: Number(d.total_trips ?? 0),
      };
    });

    return { groups: findDuplicateDriverGroups(identities), total_drivers: identities.length };
  });

/** READ-ONLY: exactly what a merge would move. Never changes anything. */
export const previewDriverMergePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ keeper_id: z.string().uuid(), duplicate_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await assertAdmin(supabase, userId);
    const { previewDriverMerge } = await import("@/lib/driverMerge.server");
    const plan = await previewDriverMerge(supabase, {
      keeperId: data.keeper_id,
      duplicateId: data.duplicate_id,
    });
    if (plan.keeper.company_id !== companyId || plan.duplicate.company_id !== companyId) {
      throw new Error("Both driver records must belong to your company");
    }
    return plan;
  });

/**
 * Execute an APPROVED merge. Requires an explicit approval flag from the review
 * screen — there is no automatic or bulk merge anywhere in the app.
 */
export const mergeDuplicateDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        keeper_id: z.string().uuid(),
        duplicate_id: z.string().uuid(),
        approve: z.literal(true),
        note: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await assertAdmin(supabase, userId);
    const { previewDriverMerge, mergeDriverRecords } = await import("@/lib/driverMerge.server");

    const plan = await previewDriverMerge(supabase, {
      keeperId: data.keeper_id,
      duplicateId: data.duplicate_id,
    });
    if (plan.keeper.company_id !== companyId || plan.duplicate.company_id !== companyId) {
      throw new Error("Both driver records must belong to your company");
    }
    if (plan.blocked) throw new Error(plan.blocked);

    return await mergeDriverRecords(supabase, {
      keeperId: data.keeper_id,
      duplicateId: data.duplicate_id,
      actorId: userId,
      note: data.note ?? null,
    });
  });
