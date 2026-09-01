/**
 * Typed client for the new EDI backend.
 *
 * Every call goes through the secure server-side bridge Edge Function
 * `redart-edi-bridge`, using the logged-in Supabase session. No EDI
 * username / password / JWT ever exists in frontend code, and the browser
 * never talks to the EDI host directly.
 *
 * The EDI backend owns claim validation, 837P generation and status — this
 * module only forwards requests and preserves backend errors.
 */
import { supabase } from "@/lib/supabaseBrowser";
import { ediErrorMessage } from "@/lib/edi";

const BRIDGE = "redart-edi-bridge";

export type EdiRequest = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

export type EdiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

/**
 * Low-level bridge call. Never throws — callers get a discriminated result so
 * the UI can render a precise backend message instead of a generic failure.
 */
export async function callEdi<T = unknown>(req: EdiRequest): Promise<EdiResult<T>> {
  const { path, method = "GET", body } = req;
  try {
    const { data, error } = await supabase.functions.invoke(BRIDGE, {
      body: { path, method, ...(body === undefined ? {} : { body }) },
    });

    if (error) {
      // supabase-js hides the response body on non-2xx; try to recover it.
      let detail: unknown = null;
      const res = (error as unknown as { context?: Response }).context;
      if (res && typeof res.json === "function") {
        try {
          detail = await res.clone().json();
        } catch {
          try {
            detail = await res.clone().text();
          } catch {
            detail = null;
          }
        }
      }
      return {
        ok: false,
        error: ediErrorMessage(detail ?? error, "EDI bridge is unavailable"),
        ...(res?.status ? { status: res.status } : {}),
      };
    }

    // Deployed bridge envelope: { success: boolean, status: number, data: upstreamBody }.
    // Older shape { ok, body } is still tolerated.
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const status = typeof d["status"] === "number" ? (d["status"] as number) : undefined;
      const failed =
        d["success"] === false ||
        d["ok"] === false ||
        (status !== undefined && (status < 200 || status >= 300));
      const inner = "data" in d ? d["data"] : "body" in d ? d["body"] : undefined;

      if (failed) {
        return {
          ok: false,
          error: ediErrorMessage(inner ?? d["error"] ?? d, "EDI request failed"),
          ...(status ? { status } : {}),
        };
      }
      if (("success" in d || "ok" in d || "status" in d) && inner !== undefined) {
        return { ok: true, data: inner as T };
      }
    }

    return { ok: true, data: data as T };
  } catch (e) {
    // Deliberately no console logging: request/response may contain PHI.
    return { ok: false, error: ediErrorMessage(e, "EDI bridge is unreachable") };
  }
}

/* ------------------------------------------------------------------ */
/* Typed endpoint helpers                                              */
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
export type EdiBatchStatus = { id?: number; status?: string; [k: string]: unknown };

/** GET /api/health/ */
export function getEdiHealth() {
  return callEdi<EdiHealth>({ path: "/api/health/", method: "GET" });
}

/** GET /api/v1/integration/lovable/ */
export function getEdiIntegrationCatalog() {
  return callEdi<EdiCatalog>({ path: "/api/v1/integration/lovable/", method: "GET" });
}

/** POST /api/v1/claims/{id}/validate/ */
export function validateEdiClaim(claimId: number | string) {
  return callEdi<EdiValidationResult>({
    path: `/api/v1/claims/${encodeURIComponent(String(claimId))}/validate/`,
    method: "POST",
    body: {},
  });
}

/** GET /api/v1/claims/{id}/status/ */
export function getEdiClaimStatus(claimId: number | string) {
  return callEdi<EdiClaimStatus>({
    path: `/api/v1/claims/${encodeURIComponent(String(claimId))}/status/`,
    method: "GET",
  });
}

/** GET /api/v1/submission-batches/{id}/status/ */
export function getEdiBatchStatus(batchId: number | string) {
  return callEdi<EdiBatchStatus>({
    path: `/api/v1/submission-batches/${encodeURIComponent(String(batchId))}/status/`,
    method: "GET",
  });
}

/* ------------------------------------------------------------------ */
/* Submission pipeline: create claim → validate → batch → 837P → queue */
/* ------------------------------------------------------------------ */

export type EdiClaim = { id?: number; status?: string; [k: string]: unknown };
export type EdiBatch = { id?: number; status?: string; file_id?: number | null; [k: string]: unknown };
export type EdiFile = { id?: number; status?: string; content?: string; [k: string]: unknown };

/**
 * POST /api/v1/claims/ — creates (or links) the EDI claim for one trip.
 * The EDI backend owns all X12/HCPF rules; this only forwards the payload.
 */
export function createEdiClaim(payload: Record<string, unknown>) {
  return callEdi<EdiClaim>({ path: "/api/v1/claims/", method: "POST", body: payload });
}

/** GET /api/v1/claims/{id}/ */
export function getEdiClaim(claimId: number | string) {
  return callEdi<EdiClaim>({
    path: `/api/v1/claims/${encodeURIComponent(String(claimId))}/`,
    method: "GET",
  });
}

/** POST /api/v1/submission-batches/ — groups validated claims into a batch. */
export function createEdiBatch(payload: { claim_ids: (number | string)[]; environment?: string }) {
  return callEdi<EdiBatch>({
    path: "/api/v1/submission-batches/",
    method: "POST",
    body: payload,
  });
}

/** POST /api/v1/submission-batches/{id}/generate/ — build the 837P file. */
export function generateEdi837P(batchId: number | string) {
  return callEdi<EdiFile>({
    path: `/api/v1/submission-batches/${encodeURIComponent(String(batchId))}/generate/`,
    method: "POST",
    body: {},
  });
}

/**
 * POST /api/v1/submission-batches/{id}/submit/ — hands the generated file to
 * the EDI backend's transport (SFTP/MFT). `environment` is always explicit so
 * production can never be reached implicitly.
 */
export function submitEdiBatch(batchId: number | string, environment: "test" | "production") {
  return callEdi<EdiBatch>({
    path: `/api/v1/submission-batches/${encodeURIComponent(String(batchId))}/submit/`,
    method: "POST",
    body: { environment },
  });
}

export type EdiAcknowledgements = {
  ack_999?: unknown;
  status_277?: unknown;
  remittance_835?: unknown;
  [k: string]: unknown;
};

/** GET /api/v1/claims/{id}/acknowledgements/ — 999 / 277 / 835 states. */
export function getEdiAcknowledgements(claimId: number | string) {
  return callEdi<EdiAcknowledgements>({
    path: `/api/v1/claims/${encodeURIComponent(String(claimId))}/acknowledgements/`,
    method: "GET",
  });
}

/** GET /api/v1/claims/{id}/remittance/ — 835 payment detail when available. */
export function getEdiRemittance(claimId: number | string) {
  return callEdi<Record<string, unknown>>({
    path: `/api/v1/claims/${encodeURIComponent(String(claimId))}/remittance/`,
    method: "GET",
  });
}

