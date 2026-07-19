# Ship RedArt as two Android apps (Passenger + Driver)

Goal: produce two installable Android apps — **RedArt Rides** (passenger) and **RedArt Driver** — from the existing web app, using Capacitor. Play Store‑ready builds plus a step‑by‑step publishing walkthrough. Web app keeps working unchanged.

## Approach

The current web app stays the single source of truth. Each Android app is a thin native shell that loads the live site (`https://redartdigital.com/passenger` or `/driver`) inside a native WebView, plus native plugins for GPS, push, camera, and background behavior. This means:

- No rewrite of screens, auth, dispatch, maps, or realtime.
- Any UI change you push to the web instantly appears in both apps (no Play Store re-review for content changes).
- Play Store re‑submission only needed when native plugins or app version bumps.

## What gets built

### 1. Two Capacitor projects in the repo
```text
android/
  passenger/     → RedArt Rides       (com.redart.rides)
  driver/        → RedArt Driver      (com.redart.driver)
```
Each has its own icon, splash screen, app name, package ID, and signing key.

### 2. Native capabilities wired in

| Capability | Passenger app | Driver app |
|---|---|---|
| Geolocation (foreground) | ✓ pickup pin | ✓ |
| **Background GPS** | — | ✓ keeps sending location when screen off |
| **Push notifications (FCM)** | ✓ "Driver arriving" | ✓ "New ride request" |
| Camera / photo picker | — | ✓ vehicle photos |
| Deep links (`redartdigital.com/…`) | ✓ | ✓ |
| Keep-awake while on trip | — | ✓ |
| Call/SMS passenger | — | ✓ |

### 3. Small web-side additions

- A tiny bridge module that detects "am I running inside the native app?" and, when true, uses Capacitor's native Geolocation/Camera/Push plugins instead of browser APIs. Same React components, better native behavior.
- Register the device's FCM token against the signed-in user so the existing dispatch code can target pushes.
- A new `/api/public/fcm-send` server route the dispatcher calls to fan out ride-request pushes to matched drivers.

### 4. Firebase project (for push)
You create one free Firebase project → I wire the `google-services.json` into both apps and add the FCM server key as a Lovable Cloud secret. No Firebase code you have to maintain — just the credential.

### 5. Play Store publishing walkthrough
A written guide covering: creating a Google Play Console account ($25 one‑time), generating upload keys, filling out the two store listings (screenshots, descriptions, privacy policy URL, data‑safety form — background location requires a short justification video, I'll give you a script), uploading the `.aab`, closed testing → production rollout.

## Deliverables

1. `android/passenger/` and `android/driver/` — buildable Android Studio projects.
2. Signed **debug APKs** for both apps you can sideload today to test on your own phone.
3. Signed **release AABs** ready to upload to Play Console.
4. Firebase + FCM integration end-to-end (driver receives push when a request is dispatched to them).
5. Background driver GPS that continues when the app is minimized or screen is off.
6. `PUBLISHING.md` in the repo — full Play Store submission walkthrough, including the background-location justification.

## What I need from you (before / during build)

- Confirm package IDs `com.redart.rides` and `com.redart.driver` (or give me your preferred ones).
- Create a free Firebase project and share `google-services.json` (I'll tell you exactly where to click).
- A privacy policy URL (required by Play Store — I can also generate a hosted `/privacy` page for you).

## Out of scope for this plan

- iOS build (Android only, as requested).
- Admin dashboard as an app (stays web-only — admins use browser).
- Rewriting screens in React Native.

## Rough sequencing

1. Add Capacitor + create both Android projects + icons/splash.
2. Native geolocation + camera bridge, tested against live site.
3. Firebase/FCM: token registration, dispatcher fan‑out, driver receive.
4. Background GPS plugin + battery-safe tracking.
5. Signed release builds + `PUBLISHING.md`.

Approve this and I'll start with step 1.
