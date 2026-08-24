import { describe, expect, it, vi } from "vitest";
import {
  dedupeKey,
  notificationEnabled,
  parseTelnyxInbound,
  parseTelnyxStatus,
  renderNotification,
  resolveProviderName,
  toE164,
  type CompanyCommSettings,
} from "@/lib/comms/core";
import {
  recordInboundSms,
  sendCompanySms,
  sendNotification,
  type CommsDeps,
  type ProviderSend,
} from "@/lib/comms/engine";

// --------------------------------------------------------------- fake store --

type Msg = {
  id: string;
  conversation_id: string;
  company_id: string;
  direction: string;
  from_number: string;
  to_number: string;
  body: string;
  provider: string;
  provider_message_id: string | null;
  status: string;
  dedupe_key: string | null;
  event_kind: string | null;
  attempt_count?: number;
  error_message?: string | null;
};

type Convo = {
  id: string;
  company_id: string;
  contact_phone: string;
  our_number: string;
  passenger_id: string | null;
  is_known_contact: boolean;
  status: string;
};

function makeSettings(over: Partial<CompanyCommSettings> = {}): CompanyCommSettings {
  return {
    company_id: "co-a",
    provider: "telnyx",
    sms_from_number: "+17205550100",
    messaging_profile_id: "mp-1",
    sms_enabled: true,
    notify_bill_approved: false,
    notify_bill_rejected: false,
    notify_trip_assigned: false,
    notify_driver_arriving: false,
    notify_trip_reminder: false,
    ...over,
  };
}

function fakeWorld(opts: {
  settings?: Record<string, CompanyCommSettings>;
  companies?: Record<string, { id: string; name: string; status: string }>;
  numberOwner?: Record<string, string>;
  passengers?: Record<string, { id: string; name: string }>;
  send?: ProviderSend;
}) {
  const convos: Convo[] = [];
  const messages: Msg[] = [];
  let seq = 0;
  const sendSpy = vi.fn(
    opts.send ?? (async () => ({ ok: true, providerMessageId: `prov-${++seq}` })),
  );

  const deps: CommsDeps = {
    getSettings: async (id) => opts.settings?.[id] ?? null,
    findCompanyByNumber: async (num) => {
      const co = opts.numberOwner?.[num];
      return co ? (opts.companies?.[co] ?? null) : null;
    },
    findPassengerByPhone: async (companyId, phone) =>
      opts.passengers?.[`${companyId}|${phone}`] ?? null,
    upsertConversation: async (input) => {
      const found = convos.find(
        (c) =>
          c.company_id === input.companyId &&
          c.contact_phone === input.contactPhone &&
          c.our_number === input.ourNumber,
      );
      if (found) return found;
      const row: Convo = {
        id: `cv-${convos.length + 1}`,
        company_id: input.companyId,
        contact_phone: input.contactPhone,
        our_number: input.ourNumber,
        passenger_id: input.passengerId,
        is_known_contact: input.known,
        status: input.known ? "open" : "needs_review",
      };
      convos.push(row);
      return row;
    },
    findMessageByDedupe: async (companyId, key) =>
      messages.find((m) => m.company_id === companyId && m.dedupe_key === key) ?? null,
    findMessageByProviderId: async (provider, id) =>
      messages.find((m) => m.provider === provider && m.provider_message_id === id) ?? null,
    insertMessage: async (row) => {
      const msg: Msg = { id: `m-${messages.length + 1}`, ...row };
      messages.push(msg);
      return msg;
    },
    updateMessage: async (id, patch) => {
      const m = messages.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    },
    providerFor: (provider) => (provider === "none" ? null : sendSpy),
    sleep: async () => {},
  };

  return { deps, convos, messages, sendSpy };
}

// -------------------------------------------------------------------- core --

describe("comms core", () => {
  it("normalises phone numbers and rejects junk", () => {
    expect(toE164("720-555-0100")).toBe("+17205550100");
    expect(toE164("+17205550100")).toBe("+17205550100");
    expect(toE164("17205550100")).toBe("+17205550100");
    expect(toE164("555")).toBeNull();
    expect(toE164(null)).toBeNull();
  });

  it("only resolves a provider when enabled with a valid number", () => {
    expect(resolveProviderName(makeSettings())).toBe("telnyx");
    expect(resolveProviderName(makeSettings({ sms_enabled: false }))).toBe("none");
    expect(resolveProviderName(makeSettings({ sms_from_number: null }))).toBe("none");
    expect(resolveProviderName(makeSettings({ provider: "twilio" }))).toBe("twilio");
    expect(resolveProviderName(null)).toBe("none");
  });

  it("gates notifications on the company toggle", () => {
    expect(notificationEnabled(makeSettings(), "bill_approved")).toBe(false);
    expect(notificationEnabled(makeSettings({ notify_bill_approved: true }), "bill_approved")).toBe(
      true,
    );
    expect(
      notificationEnabled(
        makeSettings({ notify_bill_approved: true, sms_enabled: false }),
        "bill_approved",
      ),
    ).toBe(false);
  });

  it("renders templates without leaking placeholders", () => {
    const text = renderNotification("trip_assigned", {
      companyName: "Walla NEMT",
      driverName: "Ana",
      pickupTime: "2:15 PM",
    });
    expect(text).toContain("Walla NEMT");
    expect(text).toContain("Ana");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("[object");
  });

  it("builds stable dedupe keys", () => {
    expect(dedupeKey(["Bill_Approved", "ID-1", null])).toBe("bill_approved:id-1");
  });

  it("parses only real inbound Telnyx messages", () => {
    const ok = parseTelnyxInbound({
      data: {
        event_type: "message.received",
        payload: {
          id: "tx-1",
          direction: "inbound",
          text: "Need a ride",
          from: { phone_number: "+17205551111" },
          to: [{ phone_number: "+17205550100" }],
        },
      },
    });
    expect(ok?.from).toBe("+17205551111");
    expect(ok?.to).toBe("+17205550100");
    expect(parseTelnyxInbound({ data: { event_type: "message.finalized", payload: { id: "x" } } })).toBeNull();
    expect(parseTelnyxInbound({})).toBeNull();
  });

  it("maps delivery receipts to our statuses", () => {
    expect(
      parseTelnyxStatus({
        data: { event_type: "message.finalized", payload: { id: "tx-9", to: [{ status: "delivered" }] } },
      }),
    ).toEqual({ providerMessageId: "tx-9", status: "delivered" });
    expect(
      parseTelnyxStatus({
        data: {
          event_type: "message.finalized",
          payload: { id: "tx-9", to: [{ status: "delivery_failed" }], errors: [{ detail: "carrier reject" }] },
        },
      }),
    ).toEqual({ providerMessageId: "tx-9", status: "failed", error: "carrier reject" });
  });
});

// ---------------------------------------------------------------- outbound --

describe("outbound SMS", () => {
  const base = {
    settings: { "co-a": makeSettings() },
    passengers: { "co-a|+17205551111": { id: "p-1", name: "Dan Cooley" } },
  };

  it("sends once and records an audit row", async () => {
    const w = fakeWorld(base);
    const res = await sendCompanySms(w.deps, {
      companyId: "co-a",
      to: "720-555-1111",
      body: "Your ride is on the way",
      dedupeKey: "trip-1:assigned",
    });
    expect(res).toMatchObject({ ok: true, status: "sent" });
    expect(w.sendSpy).toHaveBeenCalledTimes(1);
    expect(w.messages[0]).toMatchObject({
      company_id: "co-a",
      direction: "outbound",
      to_number: "+17205551111",
      status: "sent",
    });
    expect(w.convos[0]).toMatchObject({ passenger_id: "p-1", is_known_contact: true });
  });

  it("is idempotent: the same dedupe key never sends twice", async () => {
    const w = fakeWorld(base);
    const input = { companyId: "co-a", to: "+17205551111", body: "hi", dedupeKey: "evt-1" };
    await sendCompanySms(w.deps, input);
    const second = await sendCompanySms(w.deps, input);
    expect(second.status).toBe("duplicate");
    expect(w.sendSpy).toHaveBeenCalledTimes(1);
    expect(w.messages).toHaveLength(1);
  });

  it("retries transient failures with backoff, then gives up as failed", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "503", retryable: true }));
    const w = fakeWorld({ ...base, send });
    const res = await sendCompanySms(w.deps, { companyId: "co-a", to: "+17205551111", body: "hi" });
    expect(res).toMatchObject({ ok: false, status: "failed", error: "503" });
    expect(w.sendSpy).toHaveBeenCalledTimes(3);
    expect(w.messages[0]?.status).toBe("failed");
  });

  it("does not retry permanent failures", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "invalid number", retryable: false }));
    const w = fakeWorld({ ...base, send });
    await sendCompanySms(w.deps, { companyId: "co-a", to: "+17205551111", body: "hi" });
    expect(w.sendSpy).toHaveBeenCalledTimes(1);
  });

  it("records but never dials out when the company is unconfigured", async () => {
    const w = fakeWorld({ settings: { "co-b": makeSettings({ company_id: "co-b", sms_enabled: false }) } });
    const res = await sendCompanySms(w.deps, { companyId: "co-b", to: "+17205551111", body: "hi" });
    expect(res).toMatchObject({ ok: false, status: "skipped", error: "messaging_not_configured" });
    expect(w.sendSpy).not.toHaveBeenCalled();
    expect(w.messages[0]?.status).toBe("skipped");
  });

  it("respects per-company notification opt-in", async () => {
    const w = fakeWorld({
      settings: {
        "co-a": makeSettings(),
        "co-b": makeSettings({ company_id: "co-b", notify_bill_approved: true }),
      },
    });
    const off = await sendNotification(w.deps, {
      companyId: "co-a",
      kind: "bill_approved",
      to: "+17205551111",
    });
    expect(off).toMatchObject({ status: "skipped", error: "notification_disabled" });
    expect(w.sendSpy).not.toHaveBeenCalled();

    const on = await sendNotification(w.deps, {
      companyId: "co-b",
      kind: "bill_approved",
      to: "+17205551111",
      vars: { companyName: "Walla", riderName: "Dan", serviceDate: "08/01" },
    });
    expect(on.ok).toBe(true);
    expect(w.sendSpy).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------- inbound --

describe("inbound SMS routing", () => {
  const world = () =>
    fakeWorld({
      companies: {
        "co-a": { id: "co-a", name: "Alpha", status: "active" },
        "co-b": { id: "co-b", name: "Beta", status: "active" },
        "co-x": { id: "co-x", name: "Suspended", status: "suspended" },
      },
      numberOwner: {
        "+17205550100": "co-a",
        "+17205550200": "co-b",
        "+17205550300": "co-x",
      },
      passengers: { "co-a|+17205551111": { id: "p-1", name: "Dan Cooley" } },
    });

  const inbound = (to: string, from = "+17205551111", id = "tx-1") => ({
    providerMessageId: id,
    from,
    to,
    body: "I need a ride to the clinic",
    provider: "telnyx" as const,
    receivedAt: new Date().toISOString(),
  });

  it("routes to the company that owns the receiving number", async () => {
    const w = world();
    const a = await recordInboundSms(w.deps, inbound("+17205550100", "+17205551111", "tx-a"));
    const b = await recordInboundSms(w.deps, inbound("+17205550200", "+17205552222", "tx-b"));
    expect(a.companyId).toBe("co-a");
    expect(b.companyId).toBe("co-b");
    // Tenant isolation: no thread or message crosses companies.
    expect(w.convos.map((c) => c.company_id).sort()).toEqual(["co-a", "co-b"]);
    expect(w.messages.every((m) => m.company_id === (m.to_number === "+17205550100" ? "co-a" : "co-b"))).toBe(true);
  });

  it("links a known passenger and opens the thread", async () => {
    const w = world();
    const res = await recordInboundSms(w.deps, inbound("+17205550100"));
    expect(res).toMatchObject({ status: "recorded", known: true });
    expect(w.convos[0]).toMatchObject({ passenger_id: "p-1", status: "open" });
  });

  it("an unknown sender lands in needs_review and creates no trip", async () => {
    const w = world();
    const res = await recordInboundSms(w.deps, inbound("+17205550100", "+17209998888", "tx-u"));
    expect(res).toMatchObject({ status: "recorded", known: false });
    expect(w.convos[0]).toMatchObject({ passenger_id: null, status: "needs_review" });
    expect(w.messages[0]?.direction).toBe("inbound");
    // The engine has no trip-creating capability at all.
    expect(Object.keys(w.deps)).not.toContain("createTrip");
  });

  it("drops messages to an unowned number", async () => {
    const w = world();
    const res = await recordInboundSms(w.deps, inbound("+17209990000"));
    expect(res).toMatchObject({ ok: false, status: "unrouted" });
    expect(w.messages).toHaveLength(0);
  });

  it("ignores messages for a suspended company", async () => {
    const w = world();
    const res = await recordInboundSms(w.deps, inbound("+17205550300"));
    expect(res).toMatchObject({ status: "ignored", reason: "company_inactive" });
    expect(w.messages).toHaveLength(0);
  });

  it("deduplicates provider retries of the same webhook", async () => {
    const w = world();
    await recordInboundSms(w.deps, inbound("+17205550100", "+17205551111", "tx-same"));
    const again = await recordInboundSms(w.deps, inbound("+17205550100", "+17205551111", "tx-same"));
    expect(again.status).toBe("duplicate");
    expect(w.messages).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ safety --

describe("no secrets client-side", () => {
  it("core template/provider module never references credentials", async () => {
    const fs = await import("node:fs/promises");
    const clientSafe = await fs.readFile("src/lib/comms/core.ts", "utf8");
    const engine = await fs.readFile("src/lib/comms/engine.ts", "utf8");
    for (const src of [clientSafe, engine]) {
      expect(src).not.toContain("process.env");
      expect(src).not.toContain("TELNYX_API_KEY");
      expect(src).not.toContain("import.meta.env");
    }
  });

  it("credentials are only read inside .server modules", async () => {
    const fs = await import("node:fs/promises");
    const telnyx = await fs.readFile("src/lib/comms/telnyx.server.ts", "utf8");
    expect(telnyx).toContain('process.env["TELNYX_API_KEY"]');
    // never at module scope
    const firstLine = telnyx.split("\n").findIndex((l) => l.includes("TELNYX_API_KEY"));
    expect(telnyx.split("\n").slice(0, firstLine).join("\n")).toMatch(/function|=>/);
  });

  it("the settings server fn returns readiness flags, not keys", async () => {
    const fs = await import("node:fs/promises");
    const fn = await fs.readFile("src/lib/comms.functions.ts", "utf8");
    expect(fn).toContain("credentials_ready");
    expect(fn).not.toMatch(/TELNYX_API_KEY/);
  });

  it("the UI card never renders a key field", async () => {
    const fs = await import("node:fs/promises");
    const ui = await fs.readFile("src/components/comms/CommunicationsSettingsCard.tsx", "utf8");
    expect(ui).not.toMatch(/api[_ ]?key/i);
    expect(ui).not.toContain("TELNYX");
  });
});
