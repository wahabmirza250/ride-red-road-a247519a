import { isNativeApp } from './native';
import { safeNotificationPath } from './passengerRidePush';

let starting: Promise<void> | undefined;
export function initializeNativePushInteractions(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('pushNotificationActionPerformed', ({notification}) => {
      const path = safeNotificationPath(notification.data?.url);
      if (path) window.location.assign(path);
    });
    await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      const { toast } = await import('sonner');
      const path = safeNotificationPath(notification.data?.url);
      toast(notification.title || 'Ride update', {
        description: notification.body,
        ...(path ? {action:{label:'View ride',onClick:()=>window.location.assign(path)}} : {}),
      });
    });
  })().catch(error => { starting = undefined; throw error; });
  return starting;
}
