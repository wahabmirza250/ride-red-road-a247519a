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
  appName: 'NEMT Driver',
  webDir: 'www',
  includePlugins: ['@capacitor/app', '@capacitor/camera', '@capacitor/geolocation', '@capacitor/splash-screen', '@capacitor/status-bar'],
  server: {
    url: `${process.env.MOBILE_APP_ORIGIN || 'https://nemtsolutions.co'}/driver/signin`,
    cleartext: false,
    allowNavigation: [
      new URL(process.env.MOBILE_APP_ORIGIN || 'https://nemtsolutions.co').hostname,
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
      // Foreground location only. Background tracking needs a native service.
      permissions: ['location', 'coarseLocation'],
    },
  },
};

export default config;
