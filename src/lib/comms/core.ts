/**
 * Client-safe communications primitives: phone normalisation, provider
 * selection, message templates, dedupe keys and inbound payload parsing.
 *
 * NOTHING in this file may read a secret. Credentials live only in
 * `*.server.ts` modules and are read inside handlers from the server environment.
 */

export type CommProvider = "telnyx" | "twilio" | "none";

export type CompanyCommSettings = {
  company_id: string;
  provider: CommProvider;
  sms_from_number: string | null;
  messaging_profile_id: string | null;
  sms_enabled: boolean;
  notify_bill_approved: boolean;
  notify_bill_rejected: boolean;
  notify_trip_assigned: boolean;
  notify_driver_arriving: boolean;
  notify_trip_reminder: boolean;
};

export type NotificationKind =
  | "bill_approved"
  | "bill_rejected"
  | "trip_assigned"
  | "driver_arriving"
  | "trip_reminder";

export const NOTIFICATION_TOGGLE: Record<NotificationKind, keyof CompanyCommSettings> = {
  bill_approved: "notify_bill_approved",
  bill_rejected: "notify_bill_rejected",
  trip_assigned: "notify_trip_assigned",
  driver_arriving: "notify_driver_arriving",
  trip_reminder: "notify_trip_reminder",
};

export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  bill_approved: "Bill approved",
  bill_rejected: "Bill rejected",
  trip_assigned: "Trip assigned to a driver",
  driver_arriving: "Driver arriving",
  trip_reminder: "Upcoming trip reminder",
};

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

/** Which provider a company sends through, given its settings row. */
export function resolveProviderName(
  settings: Pick<CompanyCommSettings, "provider" | "sms_from_number" | "sms_enabled"> | null,
): CommProvider {
  if (!settings || !settings.sms_enabled) return "none";
  if (!toE164(settings.sms_from_number)) return "none";
  return settings.provider === "twilio" ? "twilio" : settings.provider === "telnyx" ? "telnyx" : "none";
}

export function notificationEnabled(
  settings: CompanyCommSettings | null,
  kind: NotificationKind,
): boolean {
  if (!settings || !settings.sms_enabled) return false;
  return settings[NOTIFICATION_TOGGLE[kind]] === true;
}

/**
 * Stable idempotency key. The same logical event for the same recipient can be
 * requested any number of times and is only ever delivered once.
 */
export function dedupeKey(parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => String(p ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(":")
    .slice(0, 200);
}

// ---------------------------------------------------------------- templates --

export type TemplateVars = Record<string, string | number | null | undefined>;

const TEMPLATES: Record<NotificationKind, (v: TemplateVars) => string> = {
  bill_approved: (v) =>
    `${v["companyName"] ?? "Dispatch"}: claim for ${v["riderName"] ?? "your trip"} on ${v["serviceDate"] ?? ""} was approved.`.trim(),
  bill_rejected: (v) =>
    `${v["companyName"] ?? "Dispatch"}: claim for ${v["riderName"] ?? "your trip"} on ${v["serviceDate"] ?? ""} needs attention${v["reason"] ? ` — ${v["reason"]}` : ""}.`,
  trip_assigned: (v) =>
    `${v["companyName"] ?? "Dispatch"}: ${v["driverName"] ?? "A driver"} is assigned to your ride${v["pickupTime"] ? ` at ${v["pickupTime"]}` : ""}.`,
  driver_arriving: (v) =>
    `${v["companyName"] ?? "Dispatch"}: ${v["driverName"] ?? "your driver"} is arriving${v["etaMinutes"] ? ` in about ${v["etaMinutes"]} min` : " shortly"}.`,
  trip_reminder: (v) =>
    `${v["companyName"] ?? "Dispatch"}: reminder — your ride is scheduled for ${v["pickupTime"] ?? "today"}${v["pickupAddress"] ? ` from ${v["pickupAddress"]}` : ""}.`,
};

/** Central template layer — one place to change wording for every channel. */
export function renderNotification(kind: NotificationKind, vars: TemplateVars = {}): string {
  return TEMPLATES[kind](vars).replace(/\s+/g, " ").trim().slice(0, 1500);
}

// ------------------------------------------------------- inbound normalising --

export type NormalizedInbound = {
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
  provider: CommProvider;
  receivedAt: string;
};

type TelnyxPayload = {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      direction?: string;
      text?: string;
      received_at?: string;
      from?: { phone_number?: string };
      to?: { phone_number?: string }[] | { phone_number?: string };
    };
  };
};

/**
 * Parse a Telnyx `message.received` webhook body. Returns null for any event we
 * do not treat as an inbound message (delivery receipts, outbound echoes, ...).
 */
export function parseTelnyxInbound(raw: unknown): NormalizedInbound | null {
  const json = raw as TelnyxPayload;
  const eventType = json?.data?.event_type;
  const p = json?.data?.payload;
  if (!p) return null;
  if (eventType && eventType !== "message.received") return null;
  if (p.direction && p.direction !== "inbound") return null;

  const toList = Array.isArray(p.to) ? p.to : p.to ? [p.to] : [];
  const from = toE164(p.from?.phone_number);
  const to = toE164(toList[0]?.phone_number);
  const id = String(p.id ?? "").trim();
  if (!from || !to || !id) return null;

  return {
    providerMessageId: id,
    from,
    to,
    body: String(p.text ?? "").trim(),
    provider: "telnyx",
    receivedAt: p.received_at ?? new Date().toISOString(),
  };
}

/** Telnyx delivery receipt → our status vocabulary. */
export function parseTelnyxStatus(
  raw: unknown,
): { providerMessageId: string; status: "sent" | "delivered" | "failed"; error?: string } | null {
  const json = raw as TelnyxPayload & {
    data?: { payload?: { errors?: { detail?: string }[]; to?: { status?: string }[] } };
  };
  const event = json?.data?.event_type ?? "";
  const p = json?.data?.payload;
  const id = String(p?.id ?? "").trim();
  if (!id) return null;
  if (event === "message.finalized" || event === "message.sent") {
    const to = Array.isArray(p?.to) ? p?.to : [];
    const st = String(to[0]?.status ?? "").toLowerCase();
    if (st === "delivered") return { providerMessageId: id, status: "delivered" };
    if (st.includes("fail") || st.includes("undeliver")) {
      const detail = (p as { errors?: { detail?: string }[] })?.errors?.[0]?.detail;
      return { providerMessageId: id, status: "failed", ...(detail ? { error: detail } : {}) };
    }
    return { providerMessageId: id, status: "sent" };
  }
  return null;
}
