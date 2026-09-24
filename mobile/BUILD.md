# NEMT Android builds

The driver and passenger apps wrap the existing hosted NEMT app using Capacitor 8. The driver web experience includes the LiveKit camera feature. The native Kotlin SDK reference was evaluated; the implementation reuses LiveKit's JavaScript SDK to fit the existing Capacitor architecture.

Run `npm ci` at the repository root (the committed lockfile pins dependencies). Install JDK 21 and Android SDK 36/build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` to those locations.

For each app:

```powershell
node mobile/prepare.mjs # from the repository root, generates both bundled launchers
cd mobile/driver # or mobile/passenger
npx cap sync android
cd android
./gradlew.bat assembleDebug
```

The APK is in `android/app/build/outputs/apk/debug/app-debug.apk`. Debug APKs are for device testing, not Play Store publication. Use a controlled release signing key before distributing to the fleet.

Default host: `https://redart-web-production.up.railway.app`. The new `nemtsolutions.co` domain is not connected yet. Set `MOBILE_APP_ORIGIN` to another trusted HTTPS origin before running both `node mobile/prepare.mjs` and `cap sync android`. Keep the same environment for both commands. The host is fixed at build time. Do not point builds at untrusted websites: that site is given the app's native bridge.

Both apps open a bundled screen, including without internet. The driver's sign-in button opens `/driver/signin`. The passenger's bundled provider form opens `/<provider-code>/passenger`, without requiring the new `/mobile/passenger` route to be deployed. Failed main-frame loads show a bundled connection error and retry form. Existing company-scoped routes and authentication remain in use. These are individual-session apps; shared-passenger kiosk behavior is not implemented.

Version 1.1 test builds use the existing live web application. New camera features still require deploying the web changes and the self-hosted server described in `../deploy/livekit/README.md`. Switch to the new domain only after DNS, HTTPS, and the app pages are verified.

GitHub Actions launches each app on an Android 35 emulator, checks the bundled screen, tests driver login navigation or passenger code validation, and forces a DNS failure to verify the retry screen. APKs are published only after these device checks pass. Debug signing keys on fresh CI runners can differ: if Android rejects an update, uninstall the previous test app first (this clears that app's local session).

Included native permissions: foreground location in both apps; camera in the driver app. No microphone, background camera, or background location permission. The unused FCM push plugin is excluded until Firebase configuration is supplied. Existing web notifications remain separate.

Device validation: sign in with a real company driver, grant camera permission, enable camera, view from a same-company administrator, close the viewer, turn the camera off, switch apps, disconnect and restore Wi-Fi, and verify another company's administrator is denied. Confirm that all camera indicators disappear after stopping. Repeat on the actual tablet and cellular connection.
