import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the RedArt Driver Android app.
 *
 * Loads the driver web experience inside a native shell so we can attach
 * background GPS + FCM push. See ../MOBILE.md for the full local build
 * and publishing walkthrough.
 */
const config: CapacitorConfig = {
  appId: 'com.redart.driver',
  appName: 'RedArt Driver',
  webDir: 'www',
  server: {
    url: 'https://redartdigital.com/driver',
    cleartext: false,
    allowNavigation: [
      'redartdigital.com',
      '*.redartdigital.com',
      '*.lovable.app',
      '*.supabase.co',
      '*.googleapis.com',
      '*.gstatic.com',
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0b0b0b',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0b0b0b',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Geolocation: {
      // Enables the OS foreground-service notification while a trip
      // is active so location tracking survives when the screen is off.
      permissions: ['location', 'coarseLocation'],
    },
  },
};

export default config;
