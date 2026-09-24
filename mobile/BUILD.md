# NEMT Android builds

The driver and passenger apps wrap the existing hosted NEMT app using Capacitor 8. The driver web experience includes the LiveKit camera feature. The native Kotlin SDK reference was evaluated; the implementation reuses LiveKit's JavaScript SDK to fit the existing Capacitor architecture.

Run `npm ci` at the repository root (the committed lockfile pins dependencies). Install JDK 21 and Android SDK 36/build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` to those locations.

For each app:

```powershell
cd mobile/driver # or mobile/passenger
npx cap sync android
cd android
./gradlew.bat assembleDebug
```

The APK is in `android/app/build/outputs/apk/debug/app-debug.apk`. Debug APKs are for device testing, not Play Store publication. Use a controlled release signing key before distributing to the fleet.

Default host: `https://nemtsolutions.co`. Set `MOBILE_APP_ORIGIN` to another trusted HTTPS origin before running `cap sync android` to make a staging build. The host is fixed at build time. Do not point production builds at untrusted websites: that site is given the app's native bridge.

The driver app opens `/driver/signin`. The passenger app opens `/mobile/passenger`, where passengers enter the provider code supplied by their transportation company. Existing company-scoped routes and authentication remain in use. These are individual-session apps; shared-passenger kiosk behavior is not implemented.

Deploy the web changes and configure the chosen HTTPS domain before installing these builds. Camera streaming additionally requires the self-hosted server described in `../deploy/livekit/README.md`.

Included native permissions: foreground location in both apps; camera in the driver app. No microphone, background camera, or background location permission. The unused FCM push plugin is excluded until Firebase configuration is supplied. Existing web notifications remain separate.

Device validation: sign in with a real company driver, grant camera permission, enable camera, view from a same-company administrator, close the viewer, turn the camera off, switch apps, disconnect and restore Wi-Fi, and verify another company's administrator is denied. Confirm that all camera indicators disappear after stopping. Repeat on the actual tablet and cellular connection.
