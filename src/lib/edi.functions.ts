/**
 * Typed client for the EDI backend — tenant-neutral reads only.
 *
 * Every call is made SERVER-SIDE: the browser calls an authenticated server
 * function, which forwards through the secure `redart-edi-bridge` Edge
 * Function (or, when the deployment provides them, server-only `EDI_API_*`
 * secrets). No EDI username / password / JWT ever exists in frontend code and
 * the browser never talks to the EDI host.
 *
 * SECURITY: `ediRequest` is deliberately NOT a general proxy. It forwards only
 * the two tenant-neutral read-only endpoints (`/api/health/` and the
 * integration catalog). Anything that names a claim, batch or 837P file id
 * goes through `ediActions.functions` / `ediBulk.functions`, which prove the
 * resource belongs to the caller's company first — otherwise one company could
 * read another's claims simply by guessing an id.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EDI_PATHS, type EdiRequest, type EdiResult } from "@/lib/ediTransport";
import { EDI_PATH_BLOCKED, isSafeEdiReadPath } from "@/lib/ediGuard";
import type { EdiConnectionProbe } from "@/lib/ediConnection";
import { ediErrorMessage } from "@/lib/edi";

export type { EdiRequest, EdiResult } from "@/lib/ediTransport";

const RequestSchema = z.object({
  path: z.string().min(1).max(300),
  method: z.enum(["GET"]).optional(),
});

/**
 * Authenticated read of a tenant-neutral EDI endpoint. Billing staff only.
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

      if (!isSafeEdiReadPath(data.path, "GET")) {
        return { ok: false, data_json: null, error: EDI_PATH_BLOCKED, status: 403 };
      }

      const { ediFetch } = await import("@/lib/ediBridge.server");
      const res = await ediFetch(supabase, { path: data.path, method: "GET" });

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
 * Low-level call behind the two read helpers below. Never throws — callers get
 * a discriminated result so the UI can render the backend's own message.
 */
export async function callEdi<T = unknown>(req: EdiRequest): Promise<EdiResult<T>> {
  try {
    const res = await ediRequest({ data: { path: req.path, method: "GET" } });
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
/* Backend payload shapes                                              */
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

/** GET /api/health/ — tenant-neutral. */
export function getEdiHealth() {
  return callEdi<EdiHealth>({ path: EDI_PATHS.health(), method: "GET" });
}

/** GET /api/v1/integration/lovable/ — the backend's own endpoint catalog. */
export function getEdiIntegrationCatalog() {
  return callEdi<EdiCatalog>({ path: EDI_PATHS.integrationCatalog(), method: "GET" });
}

/* ------------------------------------------------------------------ */
/* Connection diagnostics                                              */
/* ------------------------------------------------------------------ */

/**
 * Billing-staff probe of the EDI link. Reports WHICH transport the server can
 * use and what the backend said, so onboarding can tell "nothing is connected
 * yet" apart from "the backend answered and refused".
 *
 * Never returns a credential — only booleans, a status code and the backend's
 * own message.
 */
export const probeEdiConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EdiConnectionProbe> => {
    const { supabase, userId } = context;
    const { assertBilling } = await import("@/lib/billingHelpers");
    await assertBilling(supabase, userId);

    const { ediFetch, ediDirectConfigured, ediBridgeUrlConfigured } = await import(
      "@/lib/ediBridge.server"
    );
    const direct = ediDirectConfigured();
    const bridgeUrl = ediBridgeUrlConfigured();
    const res = await ediFetch<EdiHealth>(supabase, { path: EDI_PATHS.health(), method: "GET" });

    if (res.ok) {
      const status = res.data?.status;
      const version = res.data?.version;
      return {
        ok: true,
        direct_configured: direct,
        bridge_url_configured: bridgeUrl,
        transport: res.transport ?? null,
        status_text: typeof status === "string" ? status : null,
        version: typeof version === "string" ? version : null,
      };
    }
    return {
      ok: false,
      error: res.error,
      status: res.status ?? null,
      transport: res.transport ?? "none",
      direct_configured: direct,
      bridge_url_configured: bridgeUrl,
    };
  });
