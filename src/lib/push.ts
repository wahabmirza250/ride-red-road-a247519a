import { VAPID_PUBLIC_KEY } from "./vapid";
import { saveSubscription, removeSubscription } from "./push.functions";

const SW_URL = "/push-sw.js";
const PROMPTED_KEY = "push_prompted_v1";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerPushSW(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    return reg;
  } catch (e) {
    console.warn("[push] SW register failed", e);
    return null;
  }
}

/** Ask for permission and subscribe. Safe to call on load — bails if already prompted/denied. */
export async function ensurePushSubscribed(opts?: { force?: boolean }): Promise<boolean> {
  if (!pushSupported()) return false;
  if (Notification.permission === "denied") return false;

  const prompted = window.localStorage.getItem(PROMPTED_KEY);
  if (!opts?.force && prompted === "1" && Notification.permission !== "granted") return false;

  const reg = await registerPushSW();
  if (!reg) return false;

  if (Notification.permission !== "granted") {
    window.localStorage.setItem(PROMPTED_KEY, "1");
    const result = await Notification.requestPermission();
    if (result !== "granted") return false;
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
    } catch (e) {
      console.warn("[push] subscribe failed", e);
      return false;
    }
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  try {
    await saveSubscription({
      data: {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent,
      },
    });
    return true;
  } catch (e) {
    console.warn("[push] save subscription failed", e);
    return false;
  }
}

export async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try {
      await removeSubscription({ data: { endpoint: sub.endpoint } });
    } catch {}
    await sub.unsubscribe();
  }
}
