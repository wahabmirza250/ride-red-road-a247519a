/**
 * SERVER ONLY — the single transport to the EDI backend.
 *
 * Order of preference:
 *   1. An explicitly configured bridge endpoint `EDI_BRIDGE_URL` — used when the
 *      secure `redart-edi-bridge` function lives outside this project. Optional
 *      `EDI_BRIDGE_KEY` authenticates the call.
 *   2. The secure Supabase Edge Function bridge `redart-edi-bridge` in this
 *      project, invoked with the caller's own session (its auth/secrets stay
 *      server-side).
 *   3. A direct server-to-backend call, used only when the deployment provides
 *      `EDI_API_BASE_URL` plus either a token/API key or service credentials
 *      (`EDI_API_SERVICE_USERNAME` + `EDI_API_SERVICE_PASSWORD`) as secrets.
 *
 * The browser NEVER talks to the EDI host and never sees a credential: it can
 * only reach this module through authenticated server functions. Nothing here
 * logs request or response bodies — they contain PHI.
 */
import {
  EDI_NOT_CONFIGURED,
  isEdiConnectionError,
  normalizeEdiEnvelope,
  type EdiRequest,
  type EdiResult,
} from "@/lib/ediTransport";
import { isEdiApiPath } from "@/lib/ediGuard";
import { ediErrorMessage } from "@/lib/edi";

const BRIDGE = "redart-edi-bridge";

/** Generated Supabase clients are heavily generic; callers pass them as-is. */
type FunctionsClient = any;

export type EdiTransportKind = "bridge" | "bridge_url" | "direct" | "none";

/** Which transport this deployment can actually use right now. */
export function ediDirectConfigured(): boolean {
  return Boolean(process.env["EDI_API_BASE_URL"]);
}

/** True when a bridge endpoint outside this project was configured. */
export function ediBridgeUrlConfigured(): boolean {
  return Boolean(process.env["EDI_BRIDGE_URL"]);
}

let cachedServiceToken: { value: string; expiresAt: number } | null = null;

function configuredServiceCredentials(): { username: string; password: string } | null {
  const username = process.env["EDI_API_SERVICE_USERNAME"] ?? process.env["EDI_SERVICE_USERNAME"];
  const password = process.env["EDI_API_SERVICE_PASSWORD"] ?? process.env["EDI_SERVICE_PASSWORD"];
  return username && password ? { username, password } : null;
}

async function serviceToken(base: string, forceRefresh = false): Promise<string | null> {
  const fixedToken = process.env["EDI_API_TOKEN"];
  if (fixedToken) return fixedToken;
  if (!forceRefresh && cachedServiceToken && cachedServiceToken.expiresAt > Date.now()) {
    return cachedServiceToken.value;
  }

  const credentials = configuredServiceCredentials();
  if (!credentials) return null;
  const res = await fetch(joinUrl(base, "/api/v1/auth/token/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const payload = (await res.json().catch(() => null)) as { access?: unknown } | null;
  if (!res.ok || typeof payload?.access !== "string") {
    throw new Error(`EDI authentication failed (${res.status}).`);
  }
  cachedServiceToken = { value: payload.access, expiresAt: Date.now() + 4 * 60_000 };
  return payload.access;
}

async function directHeaders(base: string, forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await serviceToken(base, forceRefresh);
  const apiKey = process.env["EDI_API_KEY"];
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Shape guard: only EDI API paths, never an absolute URL or a traversal.
 *
 * This is the LAST line of defence, not the tenant check. Which resources a
 * caller may name is decided earlier, in `ediOwnership.server` — this only
 * makes sure the transport cannot be pointed at another host.
 */
export function isAllowedEdiPath(path: string): boolean {
  return isEdiApiPath(path);
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

/**
 * Calls a bridge deployed outside this project. Same contract as the in-project
 * function: `{ path, method, body }` in, `{ success, status, data }` out.
 */
async function callBridgeUrl<T>(req: EdiRequest): Promise<EdiResult<T>> {
  const url = process.env["EDI_BRIDGE_URL"];
  if (!url) return { ok: false, error: EDI_NOT_CONFIGURED };
  const key = process.env["EDI_BRIDGE_KEY"];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) {
    headers["apikey"] = key;
    headers["Authorization"] = `Bearer ${key}`;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: req.path,
        method: req.method ?? "GET",
        ...(req.body === undefined ? {} : { body: req.body }),
      }),
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!res.ok && (payload === null || typeof payload === "string")) {
      return {
        ok: false,
        error: ediErrorMessage(payload, `EDI bridge returned ${res.status}`),
        status: res.status,
      };
    }
    return normalizeEdiEnvelope<T>(payload);
  } catch (e) {
    return { ok: false, error: ediErrorMessage(e, "EDI bridge is unreachable") };
  }
}

async function callDirect<T>(req: EdiRequest): Promise<EdiResult<T>> {
  const base = process.env["EDI_API_BASE_URL"];
  if (!base) return { ok: false, error: EDI_NOT_CONFIGURED };
  try {
    const request = async (forceRefresh = false) => fetch(joinUrl(base, req.path), {
      method: req.method ?? "GET",
      headers: await directHeaders(base, forceRefresh),
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
    });
    let res = await request();
    if (res.status === 401 && configuredServiceCredentials()) {
      cachedServiceToken = null;
      res = await request(true);
    }
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
    // The Django API uses the same { success, message, data } envelope as the
    // external bridge. Unwrap it here so readiness checks see data.ready and
    // data.errors instead of mistaking the wrapper for an unknown response.
    return normalizeEdiEnvelope<T>(payload);
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

  // An explicitly configured endpoint wins: it means the bridge lives outside
  // this project, so invoking the local function would only 404 every call.
  if (ediBridgeUrlConfigured()) {
    const res = await callBridgeUrl<T>(req);
    if (res.ok || !isEdiConnectionError(res.error) || !ediDirectConfigured()) {
      return { ...res, transport: "bridge_url" };
    }
    return { ...(await callDirect<T>(req)), transport: "direct" };
  }

  // A deployment-level direct connection is authoritative. Do not let an old
  // in-project Edge Function with stale credentials mask a working backend.
  if (ediDirectConfigured()) {
    return { ...(await callDirect<T>(req)), transport: "direct" };
  }

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

