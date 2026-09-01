/**
 * EDI transport contract — pure, shared by client and server.
 *
 * Two responsibilities only:
 *   1. The DOCUMENTED endpoint paths of the EDI backend. Nothing may invent a
 *      path: every helper in the app builds its URL from here so a wrong path
 *      is a test failure, not a production 404.
 *   2. Normalising the secure bridge's response envelope
 *      `{ success, status, data }` (older builds: `{ ok, body }`) into a
 *      discriminated result, preserving the backend's own error text.
 */
import { ediErrorMessage } from "@/lib/edi";

/** Base path of the EDI REST API. */
export const EDI_API_BASE = "/api/v1";

/**
 * Documented endpoints. Keys are stable; values are exactly what the EDI
 * integration guide specifies.
 */
export const EDI_PATHS = {
  health: () => "/api/health/",
  integrationCatalog: () => `${EDI_API_BASE}/integration/lovable/`,

  claims: () => `${EDI_API_BASE}/claims/`,
  claimFromTrip: () => `${EDI_API_BASE}/claims/from-trip/`,
  claim: (id: number | string) => `${EDI_API_BASE}/claims/${enc(id)}/`,
  claimValidate: (id: number | string) => `${EDI_API_BASE}/claims/${enc(id)}/validate/`,
  claimStatus: (id: number | string) => `${EDI_API_BASE}/claims/${enc(id)}/status/`,

  batches: () => `${EDI_API_BASE}/submission-batches/`,
  batch: (id: number | string) => `${EDI_API_BASE}/submission-batches/${enc(id)}/`,
  batchAddClaim: (id: number | string) => `${EDI_API_BASE}/submission-batches/${enc(id)}/add-claim/`,

  generate837p: () => `${EDI_API_BASE}/edi-files/generate-837p/`,
  ediFile: (id: number | string) => `${EDI_API_BASE}/edi-files/${enc(id)}/`,
  ediFileUpload: (id: number | string) => `${EDI_API_BASE}/edi-files/${enc(id)}/upload/`,
} as const;

function enc(v: number | string): string {
  return encodeURIComponent(String(v));
}

export type EdiRequest = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

export type EdiResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/**
 * Turns whatever the bridge returned into an `EdiResult`.
 *
 * Accepts both the deployed envelope `{ success, status, data }` and the older
 * `{ ok, body }`. A bare upstream body (no envelope) is passed through as-is.
 */
export function normalizeEdiEnvelope<T>(payload: unknown, fallback = "EDI request failed"): EdiResult<T> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const d = payload as Record<string, unknown>;
    const enveloped = "success" in d || "ok" in d || ("status" in d && ("data" in d || "body" in d));
    if (enveloped) {
      const status = typeof d["status"] === "number" ? (d["status"] as number) : undefined;
      const inner = "data" in d ? d["data"] : "body" in d ? d["body"] : undefined;
      const failed =
        d["success"] === false ||
        d["ok"] === false ||
        (status !== undefined && (status < 200 || status >= 300));

      if (failed) {
        return {
          ok: false,
          error: ediErrorMessage(inner ?? d["error"] ?? d, fallback),
          ...(status ? { status } : {}),
        };
      }
      return { ok: true, data: (inner === undefined ? d : inner) as T };
    }
  }
  return { ok: true, data: payload as T };
}

/** Shown when neither the bridge nor a direct backend connection is configured. */
export const EDI_NOT_CONFIGURED =
  "EDI backend connection required — the secure bridge is not reachable from this project yet.";

/** True when the failure means "no connection", not "backend said no". */
export function isEdiConnectionError(error: string | null | undefined): boolean {
  const e = (error ?? "").toLowerCase();
  return (
    e.includes("not_found") ||
    e.includes("not found") ||
    e.includes("unreachable") ||
    e.includes("unavailable") ||
    e.includes("connection required") ||
    e.includes("failed to fetch")
  );
}
