// Server-only Twilio SMS helper. Filename ends in .server.ts so the bundler
// refuses to include it in any client graph.

export type SmsResult = { ok: boolean; sid?: string; error?: string; skipped?: boolean };

function creds() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_PHONE_NUMBER"];
  return { sid, token, from };
}

export function twilioConfigured() {
  const { sid, token, from } = creds();
  return Boolean(sid && token && from);
}

/** Normalise a US-style phone number to E.164. Returns null when unusable. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Send one SMS. Never throws — messaging is always a side channel, so a Twilio
 * outage must not break the booking/dispatch path that triggered it.
 */
export async function sendSms(to: string, body: string, fromOverride?: string | null): Promise<SmsResult> {
  const { sid, token, from } = creds();
  const dest = toE164(to);
  if (!dest) return { ok: false, error: "invalid destination number", skipped: true };
  if (!sid || !token || !(fromOverride || from)) {
    console.warn("[sms] Twilio not configured — skipping send");
    return { ok: false, error: "twilio_not_configured", skipped: true };
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: dest,
          From: String(fromOverride || from),
          Body: body.slice(0, 1500),
        }),
      },
    );
    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) {
      console.error(`[sms] Twilio ${res.status}: ${json?.message ?? "unknown error"}`);
      return { ok: false, error: json?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, sid: json.sid };
  } catch (e) {
    console.error("[sms] send failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

export async function sendSmsToMany(numbers: string[], body: string) {
  const unique = Array.from(new Set(numbers.map((n) => toE164(n)).filter(Boolean) as string[]));
  const results = await Promise.all(unique.map((n) => sendSms(n, body)));
  return {
    attempted: unique.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
