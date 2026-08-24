/**
 * Provider-agnostic, dependency-injected messaging engine.
 *
 * All I/O (database + provider HTTP) arrives through `CommsDeps`, so the tests
 * exercise the real code paths with a fake store and a fake provider — no real
 * SMS is ever sent from a test, and no credential is ever needed.
 */

import {
  dedupeKey,
  notificationEnabled,
  renderNotification,
  resolveProviderName,
  toE164,
  type CommProvider,
  type CompanyCommSettings,
  type NormalizedInbound,
  type NotificationKind,
  type TemplateVars,
} from "./core";

export type ProviderSendInput = {
  from: string;
  to: string;
  body: string;
  messagingProfileId: string | null;
};

export type ProviderSendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /** Transient failures (5xx, network, rate limit) are retried with backoff. */
  retryable?: boolean;
};

export type ProviderSend = (input: ProviderSendInput) => Promise<ProviderSendResult>;

export type MessageRow = {
  id: string;
  status: string;
  provider_message_id?: string | null;
};

export type ConversationRow = { id: string; is_known_contact: boolean; passenger_id: string | null };

export type CommsDeps = {
  getSettings: (companyId: string) => Promise<CompanyCommSettings | null>;
  findCompanyByNumber: (
    number: string,
  ) => Promise<{ id: string; name: string; status: string } | null>;
  findPassengerByPhone: (
    companyId: string,
    phone: string,
  ) => Promise<{ id: string; name: string } | null>;
  upsertConversation: (input: {
    companyId: string;
    contactPhone: string;
    ourNumber: string;
    passengerId: string | null;
    contactName: string | null;
    known: boolean;
  }) => Promise<ConversationRow>;
  findMessageByDedupe: (companyId: string, key: string) => Promise<MessageRow | null>;
  findMessageByProviderId: (
    provider: CommProvider,
    providerMessageId: string,
  ) => Promise<MessageRow | null>;
  insertMessage: (row: {
    conversation_id: string;
    company_id: string;
    direction: "inbound" | "outbound";
    from_number: string;
    to_number: string;
    body: string;
    provider: CommProvider;
    provider_message_id: string | null;
    status: string;
    dedupe_key: string | null;
    event_kind: string | null;
    sent_by: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<MessageRow>;
  updateMessage: (
    id: string,
    patch: {
      status?: string;
      provider_message_id?: string | null;
      error_message?: string | null;
      attempt_count?: number;
      sent_at?: string | null;
      delivered_at?: string | null;
    },
  ) => Promise<void>;
  /** Provider chosen from settings; `none` means "record but never dial out". */
  providerFor: (provider: CommProvider) => ProviderSend | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type SendOutcome = {
  ok: boolean;
  status: "sent" | "failed" | "skipped" | "duplicate";
  messageId?: string;
  providerMessageId?: string;
  error?: string;
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2000];

/**
 * Send one outbound SMS for a company with idempotency, delivery state, retries
 * and a full audit row. Never throws — messaging is always a side channel.
 */
export async function sendCompanySms(
  deps: CommsDeps,
  input: {
    companyId: string;
    to: string;
    body: string;
    dedupeKey?: string | null;
    eventKind?: string | null;
    sentBy?: string | null;
  },
): Promise<SendOutcome> {
  const now = deps.now ?? (() => new Date());
  const to = toE164(input.to);
  const body = String(input.body ?? "").trim();
  if (!to) return { ok: false, status: "failed", error: "invalid destination number" };
  if (!body) return { ok: false, status: "failed", error: "empty message body" };

  const settings = await deps.getSettings(input.companyId);
  const providerName = resolveProviderName(settings);
  const from = toE164(settings?.sms_from_number ?? null);

  const key = input.dedupeKey ? dedupeKey([input.dedupeKey]) : null;
  if (key) {
    const existing = await deps.findMessageByDedupe(input.companyId, key);
    if (existing) {
      return {
        ok: existing.status !== "failed",
        status: "duplicate",
        messageId: existing.id,
        ...(existing.provider_message_id
          ? { providerMessageId: existing.provider_message_id }
          : {}),
      };
    }
  }

  const send = providerName === "none" ? null : deps.providerFor(providerName);
  if (!send || !from) {
    // Not configured yet: keep an auditable record, send nothing.
    const convo = await deps.upsertConversation({
      companyId: input.companyId,
      contactPhone: to,
      ourNumber: from ?? "unassigned",
      passengerId: null,
      contactName: null,
      known: false,
    });
    const row = await deps.insertMessage({
      conversation_id: convo.id,
      company_id: input.companyId,
      direction: "outbound",
      from_number: from ?? "unassigned",
      to_number: to,
      body,
      provider: providerName,
      provider_message_id: null,
      status: "skipped",
      dedupe_key: key,
      event_kind: input.eventKind ?? null,
      sent_by: input.sentBy ?? null,
      metadata: { reason: "messaging_not_configured" },
    });
    return { ok: false, status: "skipped", messageId: row.id, error: "messaging_not_configured" };
  }

  const passenger = await deps.findPassengerByPhone(input.companyId, to);
  const convo = await deps.upsertConversation({
    companyId: input.companyId,
    contactPhone: to,
    ourNumber: from,
    passengerId: passenger?.id ?? null,
    contactName: passenger?.name ?? null,
    known: Boolean(passenger),
  });

  const row = await deps.insertMessage({
    conversation_id: convo.id,
    company_id: input.companyId,
    direction: "outbound",
    from_number: from,
    to_number: to,
    body,
    provider: providerName,
    provider_message_id: null,
    status: "sending",
    dedupe_key: key,
    event_kind: input.eventKind ?? null,
    sent_by: input.sentBy ?? null,
  });

  let lastError = "send failed";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await send({
      from,
      to,
      body,
      messagingProfileId: settings?.messaging_profile_id ?? null,
    });
    if (res.ok) {
      await deps.updateMessage(row.id, {
        status: "sent",
        provider_message_id: res.providerMessageId ?? null,
        attempt_count: attempt,
        sent_at: now().toISOString(),
        error_message: null,
      });
      return {
        ok: true,
        status: "sent",
        messageId: row.id,
        ...(res.providerMessageId ? { providerMessageId: res.providerMessageId } : {}),
      };
    }
    lastError = res.error ?? "send failed";
    if (!res.retryable || attempt === MAX_ATTEMPTS) break;
    const wait = BACKOFF_MS[attempt - 1] ?? 2000;
    if (deps.sleep) await deps.sleep(wait);
  }

  await deps.updateMessage(row.id, {
    status: "failed",
    error_message: lastError,
    attempt_count: MAX_ATTEMPTS,
  });
  return { ok: false, status: "failed", messageId: row.id, error: lastError };
}

/** Fire a templated, per-company opt-in notification. */
export async function sendNotification(
  deps: CommsDeps,
  input: {
    companyId: string;
    kind: NotificationKind;
    to: string;
    vars?: TemplateVars;
    dedupeKey?: string | null;
  },
): Promise<SendOutcome> {
  const settings = await deps.getSettings(input.companyId);
  if (!notificationEnabled(settings, input.kind)) {
    return { ok: false, status: "skipped", error: "notification_disabled" };
  }
  return sendCompanySms(deps, {
    companyId: input.companyId,
    to: input.to,
    body: renderNotification(input.kind, input.vars ?? {}),
    dedupeKey: input.dedupeKey ?? dedupeKey([input.kind, input.companyId, input.to, JSON.stringify(input.vars ?? {})]),
    eventKind: input.kind,
  });
}

export type InboundOutcome = {
  ok: boolean;
  status: "recorded" | "duplicate" | "unrouted" | "ignored";
  conversationId?: string;
  messageId?: string;
  companyId?: string;
  known?: boolean;
  reason?: string;
};

/**
 * Record an inbound SMS: route to the company that owns the receiving number,
 * link a passenger when the sender is recognised, and always land the message in
 * the dispatch inbox. An unknown sender creates a `needs_review` thread — it
 * never creates a trip on its own.
 */
export async function recordInboundSms(
  deps: CommsDeps,
  msg: NormalizedInbound,
): Promise<InboundOutcome> {
  const dupe = await deps.findMessageByProviderId(msg.provider, msg.providerMessageId);
  if (dupe) return { ok: true, status: "duplicate", messageId: dupe.id };

  const company = await deps.findCompanyByNumber(msg.to);
  if (!company) return { ok: false, status: "unrouted", reason: "no_company_owns_number" };
  if (company.status !== "active") {
    return { ok: false, status: "ignored", companyId: company.id, reason: "company_inactive" };
  }

  const passenger = await deps.findPassengerByPhone(company.id, msg.from);
  const convo = await deps.upsertConversation({
    companyId: company.id,
    contactPhone: msg.from,
    ourNumber: msg.to,
    passengerId: passenger?.id ?? null,
    contactName: passenger?.name ?? null,
    known: Boolean(passenger),
  });

  const row = await deps.insertMessage({
    conversation_id: convo.id,
    company_id: company.id,
    direction: "inbound",
    from_number: msg.from,
    to_number: msg.to,
    body: msg.body,
    provider: msg.provider,
    provider_message_id: msg.providerMessageId,
    status: "received",
    dedupe_key: null,
    event_kind: null,
    sent_by: null,
    metadata: { received_at: msg.receivedAt },
  });

  return {
    ok: true,
    status: "recorded",
    companyId: company.id,
    conversationId: convo.id,
    messageId: row.id,
    known: Boolean(passenger),
  };
}
