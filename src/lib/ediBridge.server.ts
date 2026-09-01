/**
 * SERVER ONLY — the single transport to the EDI backend.
 *
 * Order of preference:
 *   1. The secure Supabase Edge Function bridge `redart-edi-bridge`, invoked
 *      with the caller's own session (its own auth/secrets stay server-side).
 *   2. A direct server-to-backend call, used only when the deployment provides
 *      `EDI_API_BASE_URL` (+ `EDI_API_TOKEN` or `EDI_API_KEY`) as secrets.
 *
 * The browser NEVER talks to the EDI host and never sees a credential: it can
 * only reach this module through authenticated server functions. Nothing here
 * logs request or response bodies — they contain PHI.
 */
import {
  EDI_NOT_CONFIGURED,
  normalizeEdiEnvelope,
  type EdiRequest,
  type EdiResult,
} from "@/lib/ediTransport";
import { ediErrorMessage } from "@/lib/edi";

const BRIDGE = "redart-edi-bridge";

/** Generated Supabase clients are heavily generic; callers pass them as-is. */
type FunctionsClient = any;

export type EdiTransportKind = "bridge" | "direct" | "none";

/** Which transport this deployment can actually use right now. */
export function ediDirectConfigured(): boolean {
  return Boolean(process.env["EDI_API_BASE_URL"]);
}

function directHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env["EDI_API_TOKEN"];
  const apiKey = process.env["EDI_API_KEY"];
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Guards against a caller trying to point the proxy at anything but the EDI API. */
export function isAllowedEdiPath(path: string): boolean {
  if (typeof path !== "string" || !path.startsWith("/api/")) return false;
  if (path.includes("://") || path.includes("..") || path.includes("\\")) return false;
  return true;
}

async function readBridgeError(error: unknown): Promise<{ detail: unknown; status?: number }> {
  const res = (error as { context?: Response } | null)?.context;
  if (!res || typeof res.json !== "function") return { detail: error };
  try {
    return { detail: await res.clone().json(), ...(res.status ? { status: res.status } : {}) };
  } catch {
    try {
      return { detail: await res.clone().text(), ...(res.status ? { status: res.status } : {}) };
    } catch {
      return { detail: error, ...(res.status ? { status: res.status } : {}) };
    }
  }
}

function bridgeMissing(detail: unknown, status?: number): boolean {
  if (status === 404) return true;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
  return /not_found|Requested function was not found|Function not found/i.test(text);
}

async function callDirect<T>(req: EdiRequest): Promise<EdiResult<T>> {
  const base = process.env["EDI_API_BASE_URL"];
  if (!base) return { ok: false, error: EDI_NOT_CONFIGURED };
  try {
    const res = await fetch(joinUrl(base, req.path), {
      method: req.method ?? "GET",
      headers: directHeaders(),
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: ediErrorMessage(payload, `EDI backend returned ${res.status}`),
        status: res.status,
      };
    }
    return { ok: true, data: payload as T };
  } catch (e) {
    return { ok: false, error: ediErrorMessage(e, "EDI backend is unreachable") };
  }
}

/**
 * Performs one EDI backend request. Never throws: callers get a discriminated
 * result so the UI can show the backend's own message.
 */
export async function ediFetch<T = unknown>(
  supabase: FunctionsClient,
  req: EdiRequest,
): Promise<EdiResult<T> & { transport?: EdiTransportKind }> {
  if (!isAllowedEdiPath(req.path)) {
    return { ok: false, error: "Blocked: only EDI API paths may be proxied" };
  }

  const { path, method = "GET", body } = req;

  try {
    const { data, error } = await supabase.functions.invoke(BRIDGE, {
      body: { path, method, ...(body === undefined ? {} : { body }) },
    });

    if (error) {
      const { detail, status } = await readBridgeError(error);
      if (bridgeMissing(detail, status) && ediDirectConfigured()) {
        return { ...(await callDirect<T>(req)), transport: "direct" };
      }
      if (bridgeMissing(detail, status)) {
        return { ok: false, error: EDI_NOT_CONFIGURED, ...(status ? { status } : {}) };
      }
      return {
        ok: false,
        error: ediErrorMessage(detail ?? error, "EDI bridge is unavailable"),
        ...(status ? { status } : {}),
        transport: "bridge",
      };
    }

    return { ...normalizeEdiEnvelope<T>(data), transport: "bridge" };
  } catch (e) {
    if (ediDirectConfigured()) return { ...(await callDirect<T>(req)), transport: "direct" };
    return { ok: false, error: ediErrorMessage(e, EDI_NOT_CONFIGURED), transport: "none" };
  }
}
