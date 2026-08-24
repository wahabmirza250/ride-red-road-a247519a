/**
 * SERVER ONLY — notification event foundation.
 *
 * Every product event routes through here so the template layer, the per-company
 * opt-in toggles and the audit trail stay in one place. Callers never touch a
 * provider directly.
 */

import type { NotificationKind, TemplateVars } from "./core";
import { dedupeKey } from "./core";
import { sendCompanySms, sendNotification, type SendOutcome } from "./engine";

export type NotificationEvent = {
  companyId: string;
  kind: NotificationKind;
  /** Recipient phone in any US format — normalised downstream. */
  to: string;
  vars?: TemplateVars;
  /** Stable id of the thing the event is about (bill id, trip id, ...). */
  subjectId?: string | null;
};

/**
 * Fire one notification. Returns a structured outcome and never throws, so a
 * messaging outage can never break the dispatch/billing path that triggered it.
 */
export async function emitNotification(event: NotificationEvent): Promise<SendOutcome> {
  try {
    const { createCommsDeps } = await import("./store.server");
    return await sendNotification(createCommsDeps(), {
      companyId: event.companyId,
      kind: event.kind,
      to: event.to,
      ...(event.vars ? { vars: event.vars } : {}),
      dedupeKey: dedupeKey([event.kind, event.subjectId ?? "", event.to]),
    });
  } catch (e) {
    console.warn("[comms] notification failed", e);
    return { ok: false, status: "failed", error: e instanceof Error ? e.message : "failed" };
  }
}

/** Free-form dispatcher reply in an SMS thread (no template, still audited). */
export async function sendDispatchReply(input: {
  companyId: string;
  to: string;
  body: string;
  sentBy: string;
  dedupeKey?: string;
}): Promise<SendOutcome> {
  const { createCommsDeps } = await import("./store.server");
  return sendCompanySms(createCommsDeps(), {
    companyId: input.companyId,
    to: input.to,
    body: input.body,
    eventKind: "dispatch_reply",
    sentBy: input.sentBy,
    dedupeKey: input.dedupeKey ?? null,
  });
}
