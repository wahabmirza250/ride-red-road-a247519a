import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the RedArt Rides (Passenger) Android app.
 *
 * The native shell loads the live web app from the production URL, so
 * every UI change you publish to the web is instantly live in the app
 * with no Play Store re-submission. Set `server.url` to your preview
 * URL when developing.
 */
const config: CapacitorConfig = {
  appId: 'com.redart.rides',
  appName: 'RedArt Rides',
  // The `webDir` is required by the CLI even for hosted apps. It is
  // never actually shipped because `server.url` is set.
  webDir: 'www',
  server: {
    url: 'https://redartdigital.com/passenger',
    cleartext: false,
    // Only these hostnames can be navigated to inside the app shell.
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
      launchShowDuration: 1200,
      backgroundColor: '#0b0b0b',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
