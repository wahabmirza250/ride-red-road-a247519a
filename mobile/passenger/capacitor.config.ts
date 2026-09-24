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
  appName: 'NEMT Rides',
  // The `webDir` is required by the CLI even for hosted apps. It is
  // never actually shipped because `server.url` is set.
  webDir: 'www',
  includePlugins: ['@capacitor/app', '@capacitor/geolocation', '@capacitor/splash-screen', '@capacitor/status-bar'],
  server: {
    url: `${process.env.MOBILE_APP_ORIGIN || 'https://nemtsolutions.co'}/mobile/passenger`,
    cleartext: false,
    // Only these hostnames can be navigated to inside the app shell.
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
