/**
 * Super EDI data access.
 *
 * READ-ONLY over the existing billing data (billing_records + medicaid_trips),
 * plus one narrow writer that persists the EDI identifiers returned by the EDI
 * backend onto the already-present `edi_*` columns of `billing_records`.
 *
 * Nothing here touches the HCPF/robot submission path: the legacy status
 * columns are never written, and corrected resubmissions are excluded.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EdiCandidate, EdiTripDetail, EdiWorkRow } from "@/lib/ediTypes";

export type {
  EdiCandidate,
  EdiServiceLine,
  EdiTripDetail,
  EdiWorkRow,
  EdiProviderProfile,
} from "@/lib/ediTypes";

const CompanyScope = { company_id: z.string().uuid().nullable().optional() };

/** Electronic trips already in the app that can be billed through EDI. */
export const listEdiCandidateRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ...CompanyScope,
        search: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        linked_only: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<EdiCandidate[]> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiDetails } = await import("@/lib/ediRecords.server");
    const details = await loadEdiDetails(supabase, companyId, {
      ...(data.search ? { search: data.search } : {}),
      limit: data.limit ?? 50,
      ...(data.linked_only ? { linkedOnly: true } : {}),
    });

    return details.map((d) => ({
      id: d.record_id,
      trip_id: d.trip_id,
      status: d.status,
      service_date: d.trip.service_date,
      member_name: d.member.name,
      medicaid_id: d.member.medicaid_id,
      pickup_address: d.trip.pickup_address,
      dropoff_address: d.trip.dropoff_address,
      edi_claim_id: d.edi.edi_claim_id,
      edi_status: d.edi.edi_status,
    }));
  });

/**
 * The bulk Batch Review table: many bills at once, each already carrying its
 * EDI state, backend readiness and the reasons it is not ready.
 */
export const listEdiWorkbench = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ...CompanyScope,
        record_ids: z.array(z.string().uuid()).max(500).optional(),
        search: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        linked_only: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<EdiWorkRow[]> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiDetails, toWorkRow } = await import("@/lib/ediRecords.server");
    const details = await loadEdiDetails(supabase, companyId, {
      ...(data.record_ids ? { recordIds: data.record_ids } : {}),
      ...(data.search ? { search: data.search } : {}),
      limit: data.limit ?? 100,
      offset: data.offset ?? 0,
      ...(data.linked_only ? { linkedOnly: true } : {}),
    });
    return details.map(toWorkRow);
  });

/** Everything Review Billing needs for one bill — member, trip, lines, provider. */
export const getEdiTripDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ...CompanyScope, record_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<EdiTripDetail> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiDetails } = await import("@/lib/ediRecords.server");
    const [detail] = await loadEdiDetails(supabase, companyId, { recordIds: [data.record_id] });
    if (!detail) throw new Error("Billing record not found for this company");
    return detail;
  });

/**
 * Persist EDI identifiers/state returned by the EDI backend.
 * Only the `edi_*` columns are ever written — the HCPF/robot columns and the
 * bill's own workflow status are never touched from here.
 */
export const saveEdiClaimState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ...CompanyScope,
        record_id: z.string().uuid(),
        edi_claim_id: z.number().int().positive().nullable().optional(),
        edi_batch_id: z.number().int().positive().nullable().optional(),
        edi_file_id: z.number().int().positive().nullable().optional(),
        edi_status: z.string().max(120).nullable().optional(),
        edi_validation: z.record(z.string(), z.unknown()).nullable().optional(),
        edi_last_error: z.string().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { writeEdiState } = await import("@/lib/ediWrite.server");
    await writeEdiState(supabase, companyId, data.record_id, {
      ...(data.edi_claim_id !== undefined ? { edi_claim_id: data.edi_claim_id } : {}),
      ...(data.edi_batch_id !== undefined ? { edi_batch_id: data.edi_batch_id } : {}),
      ...(data.edi_file_id !== undefined ? { edi_file_id: data.edi_file_id } : {}),
      ...(data.edi_status !== undefined ? { edi_status: data.edi_status } : {}),
      ...(data.edi_validation !== undefined ? { edi_validation: data.edi_validation } : {}),
      ...(data.edi_last_error !== undefined ? { edi_last_error: data.edi_last_error } : {}),
    });
    return { ok: true as const };
  });
