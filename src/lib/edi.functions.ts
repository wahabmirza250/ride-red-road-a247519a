/**
 * Typed client for the EDI backend.
 *
 * Every call is made SERVER-SIDE: the browser calls the authenticated
 * `ediRequest` server function, which forwards through the secure
 * `redart-edi-bridge` Edge Function (or, when the deployment provides them,
 * server-only `EDI_API_*` secrets). No EDI username / password / JWT ever
 * exists in frontend code and the browser never talks to the EDI host.
 *
 * All endpoint paths come from `EDI_PATHS` — the documented contract.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EDI_PATHS, type EdiRequest, type EdiResult } from "@/lib/ediTransport";
import { ediErrorMessage } from "@/lib/edi";

export type { EdiRequest, EdiResult } from "@/lib/ediTransport";

const RequestSchema = z.object({
  path: z.string().min(1).max(300),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  body: z.unknown().optional(),
});

/**
 * Authenticated proxy to the EDI backend. Billing staff only, and only paths
 * under `/api/` — the path allow-list lives in the server transport.
 *
 * The backend body is returned JSON-encoded so the RPC boundary stays strictly
 * serializable whatever shape the EDI backend replies with.
 */
export const ediRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RequestSchema.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; data_json: string | null; error: string | null; status: number | null }> => {
      const { supabase, userId } = context;
      const { assertBilling } = await import("@/lib/billingHelpers");
      await assertBilling(supabase, userId);

      const { ediFetch } = await import("@/lib/ediBridge.server");
      const res = await ediFetch(supabase, {
        path: data.path,
        ...(data.method ? { method: data.method } : {}),
        ...(data.body === undefined ? {} : { body: data.body }),
      });

      if (res.ok) {
        return {
          ok: true,
          data_json: res.data === undefined ? null : JSON.stringify(res.data),
          error: null,
          status: null,
        };
      }
      return { ok: false, data_json: null, error: res.error, status: res.status ?? null };
    },
  );

/**
 * Low-level call used by every helper below. Never throws — callers get a
 * discriminated result so the UI can render the backend's own message.
 */
export async function callEdi<T = unknown>(req: EdiRequest): Promise<EdiResult<T>> {
  try {
    const res = await ediRequest({
      data: {
        path: req.path,
        ...(req.method ? { method: req.method } : {}),
        ...(req.body === undefined ? {} : { body: req.body }),
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: res.error ?? "EDI request failed",
        ...(res.status ? { status: res.status } : {}),
      };
    }
    return { ok: true, data: (res.data_json ? JSON.parse(res.data_json) : null) as T };
  } catch (e) {
    // Deliberately no console logging: request/response may contain PHI.
    return { ok: false, error: ediErrorMessage(e, "EDI bridge is unreachable") };
  }
}

/* ------------------------------------------------------------------ */
/* Typed endpoint helpers (documented paths only)                      */
/* ------------------------------------------------------------------ */

export type EdiHealth = { status?: string; version?: string; [k: string]: unknown };
export type EdiCatalog = Record<string, unknown>;
export type EdiClaimStatus = {
  id?: number;
  status?: string;
  batch_id?: number | null;
  file_id?: number | null;
  updated_at?: string;
  [k: string]: unknown;
};
/**
 * Validate endpoint payload (per the EDI API guide): readiness lives in
 * `ready`; `is_valid`/`valid` are tolerated for older backend builds.
 */
export type EdiValidationResult = {
  ready?: boolean;
  is_valid?: boolean;
  validation_errors?: unknown[];
  errors?: unknown[];
  warnings?: unknown[];
  [k: string]: unknown;
};
export type EdiClaim = { id?: number; status?: string; [k: string]: unknown };
export type EdiBatch = {
  id?: number;
  status?: string;
  claim_count?: number;
  [k: string]: unknown;
};
export type EdiFile = {
  id?: number;
  status?: string;
  batch_id?: number;
  file_name?: string;
  [k: string]: unknown;
};

/** GET /api/health/ */
export function getEdiHealth() {
  return callEdi<EdiHealth>({ path: EDI_PATHS.health(), method: "GET" });
}

/** GET /api/v1/integration/lovable/ — the backend's own endpoint catalog. */
export function getEdiIntegrationCatalog() {
  return callEdi<EdiCatalog>({ path: EDI_PATHS.integrationCatalog(), method: "GET" });
}

/** POST /api/v1/claims/ */
export function createEdiClaim(payload: Record<string, unknown>) {
  return callEdi<EdiClaim>({ path: EDI_PATHS.claims(), method: "POST", body: payload });
}

/** POST /api/v1/claims/from-trip/ — when the trip already exists in the EDI backend. */
export function createEdiClaimFromTrip(payload: Record<string, unknown>) {
  return callEdi<EdiClaim>({ path: EDI_PATHS.claimFromTrip(), method: "POST", body: payload });
}

/** GET /api/v1/claims/{id}/ */
export function getEdiClaim(claimId: number | string) {
  return callEdi<EdiClaim>({ path: EDI_PATHS.claim(claimId), method: "GET" });
}

/** POST /api/v1/claims/{id}/validate/ */
export function validateEdiClaim(claimId: number | string) {
  return callEdi<EdiValidationResult>({
    path: EDI_PATHS.claimValidate(claimId),
    method: "POST",
    body: {},
  });
}

/** GET /api/v1/claims/{id}/status/ */
export function getEdiClaimStatus(claimId: number | string) {
  return callEdi<EdiClaimStatus>({ path: EDI_PATHS.claimStatus(claimId), method: "GET" });
}

/** POST /api/v1/submission-batches/ */
export function createEdiBatch(payload: Record<string, unknown> = {}) {
  return callEdi<EdiBatch>({ path: EDI_PATHS.batches(), method: "POST", body: payload });
}

/** POST /api/v1/submission-batches/{id}/add-claim/ */
export function addClaimToEdiBatch(batchId: number | string, claimId: number | string) {
  return callEdi<EdiBatch>({
    path: EDI_PATHS.batchAddClaim(batchId),
    method: "POST",
    body: { claim_id: claimId },
  });
}

/** GET /api/v1/submission-batches/{id}/ */
export function getEdiBatch(batchId: number | string) {
  return callEdi<EdiBatch>({ path: EDI_PATHS.batch(batchId), method: "GET" });
}

/** POST /api/v1/edi-files/generate-837p/ — one file for the whole batch. */
export function generateEdi837P(batchId: number | string) {
  return callEdi<EdiFile>({
    path: EDI_PATHS.generate837p(),
    method: "POST",
    body: { batch_id: batchId },
  });
}

/** GET /api/v1/edi-files/{id}/ */
export function getEdiFile(fileId: number | string) {
  return callEdi<EdiFile>({ path: EDI_PATHS.ediFile(fileId), method: "GET" });
}

/** POST /api/v1/edi-files/{id}/upload/ — hands the generated file to transport. */
export function uploadEdiFile(fileId: number | string) {
  return callEdi<EdiFile>({ path: EDI_PATHS.ediFileUpload(fileId), method: "POST", body: {} });
}
