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

    // The bridge may relay a non-2xx upstream response in the payload.
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const status = typeof d["status"] === "number" ? (d["status"] as number) : undefined;
      if (d["ok"] === false || (status !== undefined && (status < 200 || status >= 300))) {
        return {
          ok: false,
          error: ediErrorMessage(d["body"] ?? d["error"] ?? d, "EDI request failed"),
          ...(status ? { status } : {}),
        };
      }
      if ("body" in d && Object.keys(d).length <= 3) {
        return { ok: true, data: d["body"] as T };
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
export type EdiValidationResult = {
  is_valid?: boolean;
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
