// Server-only staff notification fan-out: in-app feed + web push + Twilio SMS.
import { sendSmsToMany } from "@/lib/sms.server";

export type StaffNotification = {
  kind: string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
  /** Company that owns the event. When null, every admin/dispatch is notified. */
  companyId?: string | null;
  /** Extra SMS-only line (kept out of the in-app feed). */
  smsSuffix?: string;
};

/**
 * One place every dispatcher-facing alert flows through, so adding a channel
 * (SMS here) covers every notification type at once instead of per call site.
 */
export async function notifyDispatchers(n: StaffNotification) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. In-app feed (NotificationBell reads this table in realtime).
  try {
    await supabaseAdmin.from("admin_notifications").insert({
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url ?? null,
      data: { ...(n.data ?? {}), company_id: n.companyId ?? null } as never,
    });
  } catch (e) {
    console.warn("[notify] feed insert failed", e);
  }

  // 2. Who is on duty for this company?
  let q = supabaseAdmin.from("user_roles").select("user_id, role").in("role", ["admin", "dispatch"]);
  if (n.companyId) q = q.eq("company_id", n.companyId);
  const { data: roleRows } = await q;
  const userIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id).filter(Boolean)));
  if (!userIds.length) return { push: 0, sms: 0 };

  // 3. Browser push.
  let pushSent = 0;
  try {
    const { sendPushToUsers } = await import("@/lib/pushSend.server");
    const res = await sendPushToUsers(userIds, {
      title: n.title,
      body: n.body,
      url: n.url ?? "/dispatch",
      tag: `${n.kind}-${Date.now()}`,
      requireInteraction: true,
    });
    pushSent = res.sent;
  } catch (e) {
    console.warn("[notify] push failed", e);
  }

  // 4. SMS to every staff phone on file that has alerts enabled.
  //    Company-scoped alerts go through the provider layer (Telnyx/Twilio per
  //    company, with idempotency + audit); unscoped alerts use the legacy path.
  let smsSent = 0;
  try {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, phone, sms_alerts_enabled")
      .in("id", userIds);
    const numbers = (profiles ?? [])
      .filter((p) => (p as { sms_alerts_enabled?: boolean }).sms_alerts_enabled !== false)
      .map((p) => p.phone)
      .filter(Boolean) as string[];
    if (numbers.length) {
      const text = `${n.title}\n${n.body}${n.smsSuffix ? `\n${n.smsSuffix}` : ""}`;
      if (n.companyId) {
        const { createCommsDeps } = await import("@/lib/comms/store.server");
        const { sendCompanySms } = await import("@/lib/comms/engine");
        const { dedupeKey } = await import("@/lib/comms/core");
        const deps = createCommsDeps();
        const stamp = Date.now();
        const results = await Promise.all(
          Array.from(new Set(numbers)).map((to) =>
            sendCompanySms(deps, {
              companyId: n.companyId as string,
              to,
              body: text,
              eventKind: `staff_${n.kind}`,
              dedupeKey: dedupeKey(["staff", n.kind, to, stamp]),
            }),
          ),
        );
        smsSent = results.filter((r) => r.ok).length;
        // Nothing configured yet for this company — keep the legacy channel alive.
        if (!smsSent && results.every((r) => r.status === "skipped")) {
          smsSent = (await sendSmsToMany(numbers, text)).sent;
        }
      } else {
        smsSent = (await sendSmsToMany(numbers, text)).sent;
      }
    }
  } catch (e) {
    console.warn("[notify] sms failed", e);
  }

  return { push: pushSent, sms: smsSent };
}
