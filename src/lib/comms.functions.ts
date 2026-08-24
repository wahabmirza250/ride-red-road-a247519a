import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CommProvider } from "@/lib/comms/core";

export type CommSettingsView = {
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
  /** True when the server has provider credentials. The key itself never ships. */
  credentials_ready: boolean;
  signing_ready: boolean;
  inbound_webhook_path: string;
};

const COLUMNS =
  "company_id, provider, sms_from_number, messaging_profile_id, sms_enabled, notify_bill_approved, notify_bill_rejected, notify_trip_assigned, notify_driver_arriving, notify_trip_reminder";

export const getCommSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommSettingsView> => {
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("company_comm_settings")
      .select(COLUMNS)
      .eq("company_id", companyId)
      .maybeSingle();

    const { telnyxConfigured, telnyxSigningConfigured } = await import("@/lib/comms/telnyx.server");

    return {
      company_id: companyId,
      provider: (data?.provider as CommProvider) ?? "telnyx",
      sms_from_number: data?.sms_from_number ?? null,
      messaging_profile_id: data?.messaging_profile_id ?? null,
      sms_enabled: data?.sms_enabled ?? false,
      notify_bill_approved: data?.notify_bill_approved ?? false,
      notify_bill_rejected: data?.notify_bill_rejected ?? false,
      notify_trip_assigned: data?.notify_trip_assigned ?? false,
      notify_driver_arriving: data?.notify_driver_arriving ?? false,
      notify_trip_reminder: data?.notify_trip_reminder ?? false,
      credentials_ready: telnyxConfigured(),
      signing_ready: telnyxSigningConfigured(),
      inbound_webhook_path: "/api/public/telnyx-inbound",
    };
  });

type SettingsPatch = {
  provider?: CommProvider;
  sms_from_number?: string | null;
  messaging_profile_id?: string | null;
  sms_enabled?: boolean;
  notify_bill_approved?: boolean;
  notify_bill_rejected?: boolean;
  notify_trip_assigned?: boolean;
  notify_driver_arriving?: boolean;
  notify_trip_reminder?: boolean;
};

export const updateCommSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SettingsPatch) => {
    if (!input || typeof input !== "object") throw new Error("patch required");
    if (input.provider && !["telnyx", "twilio", "none"].includes(input.provider)) {
      throw new Error("unsupported provider");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId, ["admin"]);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);

    const { toE164 } = await import("@/lib/comms/core");
    const patch: Record<string, unknown> = {};
    if (data.provider) patch["provider"] = data.provider;
    if ("sms_from_number" in data) {
      const raw = (data.sms_from_number ?? "").trim();
      if (raw) {
        const e164 = toE164(raw);
        if (!e164) throw new Error("Enter a valid phone number, e.g. +17205551234");
        patch["sms_from_number"] = e164;
      } else {
        patch["sms_from_number"] = null;
      }
    }
    if ("messaging_profile_id" in data) {
      patch["messaging_profile_id"] = (data.messaging_profile_id ?? "").trim() || null;
    }
    for (const k of [
      "sms_enabled",
      "notify_bill_approved",
      "notify_bill_rejected",
      "notify_trip_assigned",
      "notify_driver_arriving",
      "notify_trip_reminder",
    ] as const) {
      if (typeof data[k] === "boolean") patch[k] = data[k];
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("company_comm_settings")
      .upsert({ company_id: companyId, ...patch }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const listSmsConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId, ["admin", "dispatch"]);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("sms_conversations")
      .select(
        "id, contact_phone, our_number, contact_name, passenger_id, status, is_known_contact, unread_count, last_message_at",
      )
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listSmsMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string }) => {
    if (!input?.conversation_id) throw new Error("conversation_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId, ["admin", "dispatch"]);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("sms_messages")
      .select("id, direction, body, status, from_number, to_number, event_kind, created_at")
      .eq("company_id", companyId) // tenant guard: service role bypasses RLS
      .eq("conversation_id", data.conversation_id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Dispatcher reply in an SMS thread. */
export const sendSmsReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string; body: string }) => {
    if (!input?.conversation_id) throw new Error("conversation_id required");
    const body = String(input.body ?? "").trim();
    if (!body) throw new Error("Message cannot be empty");
    if (body.length > 1000) throw new Error("Message is too long");
    return { conversation_id: input.conversation_id, body };
  })
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId, ["admin", "dispatch"]);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: convo } = await supabaseAdmin
      .from("sms_conversations")
      .select("id, contact_phone, company_id")
      .eq("id", data.conversation_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!convo) throw new Error("Conversation not found");

    const { sendDispatchReply } = await import("@/lib/comms/notify.server");
    const res = await sendDispatchReply({
      companyId,
      to: convo.contact_phone,
      body: data.body,
      sentBy: context.userId,
    });

    await supabaseAdmin
      .from("sms_conversations")
      .update({ unread_count: 0, status: "open" })
      .eq("id", convo.id);

    return res;
  });
