// Server-only. Send Web Push to a set of user_ids using stored subscriptions.
// Filename ends in .server.ts so the bundler refuses to include it in the client graph.
import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@redart.local";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
};

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (!userIds.length) return { sent: 0, failed: 0 };
  configure();

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (!subs?.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const stale: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (e: unknown) {
        const err = e as { statusCode?: number };
        if (err.statusCode === 404 || err.statusCode === 410) stale.push(s.id);
        failed++;
      }
    }),
  );

  if (stale.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", stale);
  }
  return { sent, failed };
}

export async function sendPushToAdmins(payload: PushPayload) {
  const { data } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  const ids = (data ?? []).map((r) => r.user_id);
  return sendPushToUsers(ids, payload);
}

export async function sendPushToAllPassengers(payload: PushPayload) {
  const { data } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "passenger");
  const ids = (data ?? []).map((r) => r.user_id);
  return sendPushToUsers(ids, payload);
}
