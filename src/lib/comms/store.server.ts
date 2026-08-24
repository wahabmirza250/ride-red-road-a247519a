/**
 * SERVER ONLY — Supabase-backed implementation of `CommsDeps`.
 *
 * Every query is explicitly company-scoped: this path uses the service role and
 * therefore bypasses RLS, so tenant isolation must be enforced here by hand
 * (RESTRICTIVE RLS still protects every client-side read).
 */

import type { CommProvider, CompanyCommSettings } from "./core";
import { toE164 } from "./core";
import type { CommsDeps, ProviderSend } from "./engine";

const SETTINGS_COLUMNS =
  "company_id, provider, sms_from_number, messaging_profile_id, sms_enabled, notify_bill_approved, notify_bill_rejected, notify_trip_assigned, notify_driver_arriving, notify_trip_reminder";

function providerFor(provider: CommProvider): ProviderSend | null {
  if (provider === "telnyx") {
    return async (input) => {
      const { telnyxSend } = await import("./telnyx.server");
      return telnyxSend(input);
    };
  }
  if (provider === "twilio") {
    // Legacy path kept alive so companies still on Twilio keep working while
    // they are migrated to Telnyx number-by-number.
    return async (input) => {
      const { sendSms } = await import("@/lib/sms.server");
      const res = await sendSms(input.to, input.body, input.from);
      return {
        ok: res.ok,
        ...(res.sid ? { providerMessageId: res.sid } : {}),
        ...(res.error ? { error: res.error } : {}),
        retryable: !res.skipped && !res.ok,
      };
    };
  }
  return null;
}

export function createCommsDeps(): CommsDeps {
  return {
    async getSettings(companyId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("company_comm_settings")
        .select(SETTINGS_COLUMNS)
        .eq("company_id", companyId)
        .maybeSingle();
      return (data as CompanyCommSettings | null) ?? null;
    },

    async findCompanyByNumber(number) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const e164 = toE164(number) ?? number;

      const { data: settings } = await supabaseAdmin
        .from("company_comm_settings")
        .select("company_id")
        .eq("sms_from_number", e164)
        .maybeSingle();

      let companyId = settings?.company_id ?? null;
      if (!companyId) {
        // Fall back to the number stored before the provider abstraction.
        const { data: legacy } = await supabaseAdmin
          .from("companies")
          .select("id")
          .eq("twilio_phone", e164)
          .maybeSingle();
        companyId = legacy?.id ?? null;
      }
      if (!companyId) return null;

      const { data: company } = await supabaseAdmin
        .from("companies")
        .select("id, name, status")
        .eq("id", companyId)
        .maybeSingle();
      return company ?? null;
    },

    async findPassengerByPhone(companyId, phone) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("passengers")
        .select("id, first_name, last_name")
        .eq("company_id", companyId)
        .eq("phone", phone)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id,
        name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
      };
    },

    async upsertConversation(input) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing } = await supabaseAdmin
        .from("sms_conversations")
        .select("id, is_known_contact, passenger_id")
        .eq("company_id", input.companyId)
        .eq("contact_phone", input.contactPhone)
        .eq("our_number", input.ourNumber)
        .maybeSingle();

      if (existing) {
        if (input.known && !existing.passenger_id) {
          await supabaseAdmin
            .from("sms_conversations")
            .update({
              passenger_id: input.passengerId,
              contact_name: input.contactName,
              is_known_contact: true,
              status: "open",
            })
            .eq("id", existing.id);
        }
        return {
          id: existing.id,
          is_known_contact: existing.is_known_contact || input.known,
          passenger_id: existing.passenger_id ?? input.passengerId,
        };
      }

      const { data, error } = await supabaseAdmin
        .from("sms_conversations")
        .insert({
          company_id: input.companyId,
          contact_phone: input.contactPhone,
          our_number: input.ourNumber,
          passenger_id: input.passengerId,
          contact_name: input.contactName,
          is_known_contact: input.known,
          status: input.known ? "open" : "needs_review",
        })
        .select("id, is_known_contact, passenger_id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async findMessageByDedupe(companyId, key) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("sms_messages")
        .select("id, status, provider_message_id")
        .eq("company_id", companyId)
        .eq("dedupe_key", key)
        .maybeSingle();
      return data ?? null;
    },

    async findMessageByProviderId(provider, providerMessageId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("sms_messages")
        .select("id, status, provider_message_id")
        .eq("provider", provider)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      return data ?? null;
    },

    async insertMessage(row) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("sms_messages")
        .insert({ ...row, metadata: (row.metadata ?? {}) as never })
        .select("id, status, provider_message_id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateMessage(id, patch) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("sms_messages").update(patch).eq("id", id);
    },

    providerFor,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
