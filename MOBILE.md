# RedArt — Android App Build Guide

This project ships as **two Android apps** built with [Capacitor](https://capacitorjs.com/):

| App | Package ID | Loads |
|---|---|---|
| **RedArt Rides** (passenger) | `com.redart.rides` | `https://redartdigital.com/passenger` |
| **RedArt Driver** | `com.redart.driver` | `https://redartdigital.com/driver` |

Both are thin native shells around the live web app, so any UI change you publish to the web is instantly live in the app — you only re‑submit to the Play Store when native code, icons, or permissions change.

---

## What's already in the repo

- `mobile/passenger/capacitor.config.ts` — passenger app config
- `mobile/driver/capacitor.config.ts` — driver app config
- `src/lib/native.ts` — runtime bridge: native geolocation, camera, and FCM push when running inside the app; no‑op on web
- Capacitor + plugin packages in `package.json` (`@capacitor/core`, `android`, `geolocation`, `camera`, `push-notifications`, `app`, `splash-screen`, `status-bar`)

Nothing in the web build changed — the deployed site keeps working exactly as before.

---

## One‑time setup (on your Mac / PC)

You need these installed **locally** (not in Lovable — Android Studio and the Android SDK cannot run in the cloud sandbox):

1. **Node 20+** and **Bun** (or npm)
2. **Java 17** (`brew install --cask temurin@17` on Mac)
3. **Android Studio** — <https://developer.android.com/studio> — during setup let it install: Android SDK Platform 34, Android SDK Build‑Tools, Android SDK Command‑line Tools, Android Emulator
4. Clone this repo locally and run `bun install`

---

## Building the Passenger app

```bash
# 1. Move into the passenger project
cd mobile/passenger

# 2. Create an empty `www` folder — required by the CLI even though the
#    app loads the live URL (server.url in capacitor.config.ts)
mkdir -p www && echo "<!doctype html><title>redirect</title>" > www/index.html

# 3. Generate the native Android project (first time only)
npx cap add android

# 4. Sync config + plugins into the native project
npx cap sync android

# 5. Open in Android Studio to build / run on a device
npx cap open android
```

In Android Studio, click **Run ▶** with a USB‑connected phone (Developer Mode + USB Debugging enabled) or an emulator to install and launch.

## Building the Driver app

Same commands, in `mobile/driver/`:

```bash
cd mobile/driver
mkdir -p www && echo "<!doctype html><title>redirect</title>" > www/index.html
npx cap add android
npx cap sync android
npx cap open android
```

---

## App icon and splash screen

1. Prepare a **1024×1024 PNG** of the logo (one per app — the two apps have different icons).
2. Install the icon generator: `bun add -d @capacitor/assets`
3. Drop your icon at `mobile/passenger/assets/icon.png` (and again in `mobile/driver/assets/`).
4. Generate:
   ```bash
   cd mobile/passenger && npx @capacitor/assets generate --android
   cd mobile/driver    && npx @capacitor/assets generate --android
   ```
5. `npx cap sync android` to copy the generated icons into the native project.

---

## Push notifications (Firebase Cloud Messaging)

Native Android push requires Firebase. This is a one‑time free setup.

1. Go to <https://console.firebase.google.com> → **Add project** → name it `RedArt`.
2. Add **two Android apps** to the project:
   - Package name `com.redart.rides` → download `google-services.json`
   - Package name `com.redart.driver` → download `google-services.json`
3. Place each file at `mobile/<app>/android/app/google-services.json`.
4. Re‑sync: `npx cap sync android` (from inside each app folder).
5. In Firebase console → **Project Settings → Cloud Messaging** copy the **Server key** and send it to us — we store it as a Lovable Cloud secret (`FCM_SERVER_KEY`) so the dispatcher can send targeted pushes.

The `registerNativePush()` helper in `src/lib/native.ts` already asks for permission and returns the device token — call it after sign‑in and post the token to your existing `saveSubscription` (or a new `saveFcmToken`) endpoint so dispatch can target the right driver.

---

## Background driver GPS

For location tracking that survives the screen turning off, install the community background‑geolocation plugin inside the driver project:

```bash
cd mobile/driver
bun add @capacitor-community/background-geolocation
npx cap sync android
```

Then in the driver web code (behind an `isNativeApp()` check so it doesn't run on the web), start tracking when the driver goes online and stop when they go offline. The plugin creates the required Android foreground‑service notification automatically.

> Play Store note — background location requires a short in‑console justification ("Driver must share live location with dispatched passenger for the entire trip"). Google usually approves this for rideshare/NEMT apps within 1–3 days.

---

## Producing a signed release build (for the Play Store)

Inside Android Studio for each app:

1. **Build → Generate Signed Bundle / APK → Android App Bundle**.
2. Create a new keystore (save the `.jks` file and password somewhere safe — you need the exact same key for every future update).
3. Choose the **release** build variant and click **Finish**.
4. The `.aab` lands under `android/app/build/outputs/bundle/release/`.

---

## Publishing to the Play Store

1. **Google Play Console account** — <https://play.google.com/console> — $25 one‑time.
2. **Create app** (do this twice, once per app):
   - App name: *RedArt Rides* / *RedArt Driver*
   - Default language: English (US)
   - App or game: App
   - Free or paid: Free
3. Fill out the required forms in the left sidebar:
   - **Store listing** — short description, full description, screenshots (min 2, phone), 512×512 app icon, 1024×500 feature graphic.
   - **Privacy policy** — required. If you don't have one, ask us and we'll add a `/privacy` page to the site.
   - **Data safety** — declare Location, Personal info (name, email, phone), and User content (photos, if driver app). Say data is encrypted in transit and users can request deletion.
   - **App content** → Target audience, Ads (No), Content rating (fill questionnaire — will be *Everyone*).
   - **Government apps** → No.
4. **Production → Create new release** → upload the `.aab`, add release notes, roll out to production.
5. First review takes 1–7 days; updates are usually approved in a few hours.

### For the driver app — background location justification

Play Console asks *why* you need background location. Use this script:

> RedArt Driver is a non‑emergency medical transport driver app. During an active trip, we track the driver's location in the background so the dispatched passenger and the operations team can see live ETA and route progress until the trip ends. Background location stops the moment the driver ends the trip or goes offline. Users are shown a persistent foreground‑service notification whenever tracking is active.

Also record a ≤30‑second screencap of the driver going online, accepting a trip, and the persistent notification appearing. Play Console lets you upload it in the same form.

---

## Updating an app

- **UI / feature changes only** — publish the web change from Lovable. The app picks it up on next launch. No Play Store action needed.
- **Native change** (new permission, plugin, icon, splash, package version):
  1. Bump `versionCode` and `versionName` in `mobile/<app>/android/app/build.gradle`.
  2. `npx cap sync android`
  3. Build a new signed `.aab`.
  4. Upload it as a new release in Play Console.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App opens to a blank white screen | Check `server.url` in the capacitor config points to a reachable https URL. Cleartext http is blocked by default. |
| Location prompt never appears | Confirm `ACCESS_FINE_LOCATION` is in `android/app/src/main/AndroidManifest.xml` (Capacitor's Geolocation plugin adds it on sync — re‑run `npx cap sync android`). |
| Push token comes back `null` | `google-services.json` missing or package name mismatch. Re‑download from Firebase for the exact package ID and re‑sync. |
| Play Console rejects for background location | Re‑submit with the justification screencap above; almost always approved on second try. |

---

Questions? Ping us and we'll walk you through the Play Console screens.
