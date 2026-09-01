/**
 * Read paths for the Super EDI workspace (client-callable).
 *
 * Every read is company-scoped through `resolveEdiScope`, so a platform owner
 * can administer another company only when the server says so. Writes live in
 * `ediBulk.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EdiTripDetail, EdiWorkRow } from "@/lib/ediTypes";

const CompanyScope = { company_id: z.string().uuid().nullable().optional() };

export type EdiWorkbenchPage = {
  company_id: string;
  rows: EdiWorkRow[];
  /** Bills matching the scope filter, ignoring the free-text search. */
  total: number;
  /** More pages exist beyond this window. */
  has_more: boolean;
};

export const listEdiWorkbench = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ...CompanyScope,
        search: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(300).optional(),
        offset: z.number().int().min(0).optional(),
        scope: z.enum(["all", "linked", "unlinked"]).optional(),
        trip_ids: z.array(z.string().uuid()).max(300).optional(),
        record_ids: z.array(z.string().uuid()).max(300).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<EdiWorkbenchPage> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiDetails, toWorkRow } = await import("@/lib/ediRecords.server");
    const limit = data.limit ?? 100;
    const offset = data.offset ?? 0;
    const scope = data.scope ?? "all";

    const details = await loadEdiDetails(supabase, companyId, {
      ...(data.record_ids?.length ? { recordIds: data.record_ids } : {}),
      ...(data.trip_ids?.length ? { tripIds: data.trip_ids } : {}),
      ...(data.search ? { search: data.search } : {}),
      limit,
      offset,
      linkedOnly: scope === "linked",
      unlinkedOnly: scope === "unlinked",
    });

    // Honest total for the pager: count the same filter without the search.
    let total = details.length;
    if (!data.record_ids?.length && !data.trip_ids?.length) {
      let countQuery = supabase
        .from("billing_records")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .is("resubmission_id", null);
      if (scope === "linked") countQuery = countQuery.not("edi_claim_id", "is", null);
      if (scope === "unlinked") countQuery = countQuery.is("edi_claim_id", null);
      const { count } = await countQuery;
      total = count ?? details.length;
    }

    return {
      company_id: companyId,
      rows: details.map(toWorkRow),
      total,
      has_more: offset + limit < total,
    };
  });

export const getEdiTripDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ...CompanyScope, record_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<EdiTripDetail | null> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiDetails } = await import("@/lib/ediRecords.server");
    const [detail] = await loadEdiDetails(supabase, companyId, { recordIds: [data.record_id] });
    return detail ?? null;
  });
