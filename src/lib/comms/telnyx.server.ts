/**
 * SERVER ONLY — Telnyx Messaging adapter.
 *
 * TELNYX_API_KEY and TELNYX_PUBLIC_KEY are read inside functions, never at
 * module scope, and never leave this file. Nothing here is importable from a
 * client bundle (filename ends in .server.ts).
 */

import type { ProviderSend } from "./engine";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";

export function telnyxConfigured(): boolean {
  return Boolean(process.env["TELNYX_API_KEY"]);
}

export function telnyxSigningConfigured(): boolean {
  return Boolean(process.env["TELNYX_PUBLIC_KEY"]);
}

export const telnyxSend: ProviderSend = async ({ from, to, body, messagingProfileId }) => {
  const key = process.env["TELNYX_API_KEY"];
  if (!key) return { ok: false, error: "telnyx_not_configured", retryable: false };

  try {
    const res = await fetch(TELNYX_MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        text: body.slice(0, 1500),
        ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      errors?: { detail?: string; title?: string }[];
    };

    if (!res.ok) {
      const detail = json.errors?.[0]?.detail ?? json.errors?.[0]?.title ?? `HTTP ${res.status}`;
      console.error(`[telnyx] send failed ${res.status}: ${detail}`);
      return {
        ok: false,
        error: detail,
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    return { ok: true, ...(json.data?.id ? { providerMessageId: json.data.id } : {}) };
  } catch (e) {
    console.error("[telnyx] send error", e);
    return { ok: false, error: e instanceof Error ? e.message : "network error", retryable: true };
  }
};

/**
 * Telnyx webhook signing: Ed25519 over `${timestamp}|${rawBody}` using the
 * portal's public key, with a replay window on the timestamp.
 */
export async function verifyTelnyxSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  toleranceSeconds?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const publicKeyB64 = process.env["TELNYX_PUBLIC_KEY"];
  if (!publicKeyB64) return { ok: false, reason: "missing_public_key" };
  if (!input.signature || !input.timestamp) return { ok: false, reason: "missing_headers" };

  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return { ok: false, reason: "stale_timestamp" };

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(publicKeyB64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${input.timestamp}|${input.rawBody}`);
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      base64ToBytes(input.signature),
      signed,
    );
    return ok ? { ok: true } : { ok: false, reason: "signature_mismatch" };
  } catch (e) {
    console.error("[telnyx] signature verify error", e);
    return { ok: false, reason: "verify_error" };
  }
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.trim());
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
