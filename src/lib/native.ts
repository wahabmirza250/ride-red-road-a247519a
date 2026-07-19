/**
 * Native (Capacitor) runtime bridge.
 *
 * Safe to import from anywhere in the app: on the web this returns
 * `isNative === false` and every helper falls back to a no-op or the
 * browser implementation. Inside the Android/iOS Capacitor shell it
 * dynamically loads the plugin and uses it. Nothing here runs during SSR.
 */

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Capacitor injects this global into every WebView it creates.
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

export function nativePlatform(): 'android' | 'ios' | 'web' {
  if (typeof window === 'undefined') return 'web';
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const p = cap?.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : 'web';
}

/**
 * Ask for foreground location permission and return a single position.
 * Uses the native Geolocation plugin when running in the app (better
 * accuracy, respects Android runtime perms) and falls back to the
 * browser's `navigator.geolocation` on the web.
 */
export async function getCurrentPositionSmart(): Promise<{ lat: number; lng: number } | null> {
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') return null;
      }
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch (e) {
      console.warn('[native] geolocation failed', e);
      return null;
    }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

/**
 * Register for FCM push notifications on Android. No-op on web (web push
 * continues to use the existing VAPID/service-worker flow).
 *
 * Returns the device push token so callers can persist it against the
 * signed-in user for targeted dispatch.
 */
export async function registerNativePush(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') return null;
    }
    await PushNotifications.register();
    return await new Promise<string | null>((resolve) => {
      const done = (token: string | null) => {
        PushNotifications.removeAllListeners();
        resolve(token);
      };
      PushNotifications.addListener('registration', (t) => done(t.value));
      PushNotifications.addListener('registrationError', () => done(null));
      // Safety timeout — some devices delay FCM registration.
      setTimeout(() => done(null), 10000);
    });
  } catch (e) {
    console.warn('[native] push register failed', e);
    return null;
  }
}

/**
 * Open the native photo picker or camera on Android; falls back to a
 * regular file input on the web via the returned `null` (callers should
 * render an <input type="file"> when this returns null).
 */
export async function pickPhotoNative(): Promise<{ dataUrl: string } | null> {
  if (!isNativeApp()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
    });
    return photo.dataUrl ? { dataUrl: photo.dataUrl } : null;
  } catch (e) {
    console.warn('[native] camera failed', e);
    return null;
  }
}
