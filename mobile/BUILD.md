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

Default host: `https://nemtsolutions.co`. Set `MOBILE_APP_ORIGIN` to another trusted HTTPS origin before running both `node mobile/prepare.mjs` and `cap sync android`. Keep the same environment for both commands. The host is fixed at build time. Do not point builds at untrusted websites: that site is given the app's native bridge.

Both apps open a bundled company-code screen, including without internet. The driver opens `/<provider-code>/driver/signin` and the passenger opens `/<provider-code>/passenger/signin`. Failed main-frame loads show a bundled connection error and retry form. These are individual-session apps; shared-passenger kiosk behavior is not implemented.

Version 1.2 requires the company-access web release for the new passenger sign-in route. Publish the web release before distributing these APKs. DNS and HTTPS for `nemtsolutions.co` are connected.

GitHub Actions launches each app on an Android 35 emulator, checks the bundled screen, tests invalid codes and company-specific navigation in both apps, and forces a DNS failure to verify the retry screen. APKs are published only after these device checks pass. Authentication and app content must also be checked against the deployed web release; these startup tests only verify navigation and bundled recovery. Debug signing keys on fresh CI runners can differ: if Android rejects an update, uninstall the previous test app first (this clears that app's local session).

Included native permissions: foreground location in both apps; camera in the driver app. No microphone, background camera, or background location permission. The unused FCM push plugin is excluded until Firebase configuration is supplied. Existing web notifications remain separate.

Device validation: sign in with a real company driver, grant camera permission, accept the seven-day recording notice, view live video and saved clips from a same-company administrator, close the viewer, sign out to stop camera use, switch apps, disconnect and restore Wi-Fi, and verify another company's administrator is denied. Confirm that all camera indicators disappear after stopping. Repeat on the actual tablet and cellular connection.

## Company access (version 1.2)

Both launchers ask for the same company code and open `https://nemtsolutions.co/<code>/driver/signin` or `/passenger/signin`. Company accounts are issued by administrators; public registration is disabled. Existing APKs remain supported through the web sign-in routes.

## Recording and notification release validation

Apply `app_review_security_and_recordings` before deploying this web release. Video-only recording runs while the app is visible, in independent 30-second clips. The local pending queue is capped at 200 MB; a full or unavailable queue blocks the camera gate instead of silently losing footage. Unuploaded clips expire locally on the next queue operation. This is not background dashcam recording; keep the managed tablet app visible during service. A force-close can lose the currently open clip.

The private `vehicle-recordings` bucket is served through five-minute-or-shorter signed viewing links. Access expires seven days after capture. The Node server removes expired storage objects every 15 minutes, retrying after outages. Monitor cleanup failures. An idle/stopped server delays physical removal; expired footage remains unavailable through the application.

For native notifications, supply the Firebase `google-services.json` separately for each Android app before `cap sync`. The plugin is included only when that file exists; builds without it remain usable but cannot receive native push. Set `FIREBASE_SERVICE_ACCOUNT_JSON` as a server-only Railway secret for the matching Firebase project. Never commit private service-account credentials. Verify a generic notification with the app foregrounded, backgrounded and screen locked, and verify sign-out unregisters the device. No Firebase credentials are included in this change.
