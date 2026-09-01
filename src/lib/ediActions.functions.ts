/**
 * Vetted, company-scoped EDI actions callable from the browser.
 *
 * The UI never names an EDI claim / batch / file id it received from anywhere
 * but its own company's rows, and the server proves ownership again before
 * every call (see `ediOwnership.server`). A platform owner may administer any
 * company; everyone else is pinned to their own by `resolveEdiScope`.
 *
 * Backend payloads cross the RPC boundary JSON-encoded so the contract stays
 * serialisable whatever shape the EDI backend answers with.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EdiContractRow } from "@/lib/ediCatalog";
import type { EdiCompanyMapping, EdiBatchLedgerRow } from "@/lib/ediLedger.server";
import type { EdiCompanySyncReport } from "@/lib/ediSync";

const CompanyScope = { company_id: z.string().uuid().nullable().optional() };

export type EdiCallResult = {
  ok: boolean;
  claim_id: number | null;
  data_json: string | null;
  error: string | null;
  status: number | null;
};

const encode = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);

/* ------------------------------------------------------------------ */
/* Single bill: get / validate / status                                */
/* ------------------------------------------------------------------ */

export const ediRecordAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ...CompanyScope,
        record_id: z.string().uuid(),
        action: z.enum(["get", "validate", "status"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<EdiCallResult> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const api = await import("@/lib/ediApi.server");
    const { writeEdiState } = await import("@/lib/ediWrite.server");
    const { EdiAccessError } = await import("@/lib/ediOwnership.server");

    try {
      if (data.action === "validate") {
        const res = await api.claimValidateForRecord(supabase, companyId, data.record_id);
        if (!res.ok) {
          await writeEdiState(supabase, companyId, data.record_id, {
            edi_status: "validation_failed",
            edi_last_error: res.error,
          });
          return {
            ok: false,
            claim_id: res.claim_id,
            data_json: null,
            error: res.error,
            status: res.status ?? null,
          };
        }
        const { ediIsValid } = await import("@/lib/edi");
        const ready = ediIsValid(res.data);
        await writeEdiState(supabase, companyId, data.record_id, {
          edi_status: ready ? "ready" : "not_ready",
          edi_validation: (res.data ?? {}) as Record<string, unknown>,
          edi_last_error: null,
        });
        return { ok: true, claim_id: res.claim_id, data_json: encode(res.data), error: null, status: null };
      }

      if (data.action === "status") {
        const res = await api.claimStatusForRecord(supabase, companyId, data.record_id);
        if (!res.ok) {
          return {
            ok: false,
            claim_id: res.claim_id,
            data_json: null,
            error: res.error,
            status: res.status ?? null,
          };
        }
        const { ediBackendStatus } = await import("@/lib/ediStatusFeed");
        const payload = (res.data ?? {}) as Record<string, unknown>;
        const backendStatus = ediBackendStatus(payload);
        await writeEdiState(supabase, companyId, data.record_id, {
          edi_status_detail: payload,
          ...(backendStatus ? { edi_status: backendStatus } : {}),
          edi_last_error: null,
        });
        return { ok: true, claim_id: res.claim_id, data_json: encode(payload), error: null, status: null };
      }

      const res = await api.claimGetForRecord(supabase, companyId, data.record_id);
      return res.ok
        ? { ok: true, claim_id: res.claim_id, data_json: encode(res.data), error: null, status: null }
        : {
            ok: false,
            claim_id: res.claim_id,
            data_json: null,
            error: res.error,
            status: res.status ?? null,
          };
    } catch (e) {
      if (e instanceof EdiAccessError)
        return { ok: false, claim_id: null, data_json: null, error: e.message, status: 404 };
      throw e;
    }
  });

/* ------------------------------------------------------------------ */
/* Batch / file lookups                                                */
/* ------------------------------------------------------------------ */

export const ediBatchInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ...CompanyScope, batch_id: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<EdiCallResult> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);
    const { batchGet } = await import("@/lib/ediApi.server");
    const { EdiAccessError } = await import("@/lib/ediOwnership.server");
    try {
      const res = await batchGet(supabase, companyId, data.batch_id);
      return res.ok
        ? { ok: true, claim_id: null, data_json: encode(res.data), error: null, status: null }
        : { ok: false, claim_id: null, data_json: null, error: res.error, status: res.status ?? null };
    } catch (e) {
      if (e instanceof EdiAccessError)
        return { ok: false, claim_id: null, data_json: null, error: e.message, status: 404 };
      throw e;
    }
  });

export const ediFileInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ...CompanyScope, file_id: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<EdiCallResult> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);
    const { fileGet } = await import("@/lib/ediApi.server");
    const { EdiAccessError } = await import("@/lib/ediOwnership.server");
    try {
      const res = await fileGet(supabase, companyId, data.file_id);
      return res.ok
        ? { ok: true, claim_id: null, data_json: encode(res.data), error: null, status: null }
        : { ok: false, claim_id: null, data_json: null, error: res.error, status: res.status ?? null };
    } catch (e) {
      if (e instanceof EdiAccessError)
        return { ok: false, claim_id: null, data_json: null, error: e.message, status: 404 };
      throw e;
    }
  });

/* ------------------------------------------------------------------ */
/* Company onboarding: sync + mapping + contract check                 */
/* ------------------------------------------------------------------ */

export const ediSyncCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...CompanyScope }).parse(d))
  .handler(async ({ data, context }): Promise<EdiCompanySyncReport> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiCompanySettings } = await import("@/lib/ediSetup.server");
    const settings = await loadEdiCompanySettings(supabase, companyId);

    const { syncCompanyEntities } = await import("@/lib/ediSync.server");
    return syncCompanyEntities(supabase, companyId, settings);
  });

export type EdiMappingView = {
  mapping: EdiCompanyMapping;
  shared_partner_configured: boolean;
  batches: EdiBatchLedgerRow[];
};

export const getEdiMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...CompanyScope }).parse(d))
  .handler(async ({ data, context }): Promise<EdiMappingView> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadCompanyMapping, listBatchLedger } = await import("@/lib/ediLedger.server");
    const [mapping, batches] = await Promise.all([
      loadCompanyMapping(supabase, companyId),
      listBatchLedger(supabase, companyId, 10),
    ]);
    return {
      mapping,
      shared_partner_configured: Boolean(process.env["EDI_SHARED_TRADING_PARTNER_ID"]),
      batches,
    };
  });

export type EdiContractView = {
  ok: boolean;
  message: string;
  rows: EdiContractRow[];
  entity_paths: Record<string, string | null>;
  error: string | null;
};

/** Read-only: compares the documented contract against the backend catalog. */
export const ediContractCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...CompanyScope }).parse(d))
  .handler(async ({ data, context }): Promise<EdiContractView> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadCatalogState } = await import("@/lib/ediSync.server");
    const { ediContractReport, ediContractSummary } = await import("@/lib/ediCatalog");
    const state = await loadCatalogState(supabase);
    if (state.error) {
      return {
        ok: false,
        message: state.error,
        rows: [],
        entity_paths: state.paths,
        error: state.error,
      };
    }
    const rows = ediContractReport(state.index);
    const summary = ediContractSummary(rows);
    return {
      ok: summary.ok,
      message: summary.message,
      rows,
      entity_paths: state.paths,
      error: null,
    };
  });
