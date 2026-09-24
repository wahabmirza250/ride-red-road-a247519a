import type { CapacitorConfig } from '@capacitor/cli';

// Start from bundled HTML so launching never depends on DNS or a web deployment.
// Run node mobile/prepare.mjs with the same environment before cap sync.
const origin = new URL(process.env.MOBILE_APP_ORIGIN || 'https://redart-web-production.up.railway.app');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('MOBILE_APP_ORIGIN must be a trusted HTTPS origin.');
}
const config: CapacitorConfig = {
  appId: 'com.redart.rides',
  appName: 'NEMT Rides',
  webDir: 'www',
  includePlugins: ['@capacitor/app', '@capacitor/geolocation', '@capacitor/splash-screen', '@capacitor/status-bar'],
  server: {
    cleartext: false,
    allowNavigation: [origin.hostname],
    errorPath: 'error.html',
  },
  android: { allowMixedContent: false, backgroundColor: '#f3f6fa' },
  plugins: {
    SplashScreen: { launchShowDuration: 500, backgroundColor: '#f3f6fa', showSpinner: false },
  },
};
export default config;
