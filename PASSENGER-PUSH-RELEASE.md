# Passenger ride notifications

Prepared for NEMT Solutions. Not deployed or connected to real devices yet.

## Behavior

Passenger alerts cover driver assignment, driver on the way, arrival, ride start, completion and cancellation. The notification contains no passenger names, pickup addresses or medical details. Tapping opens the owning company's My rides page. Foreground alerts appear in the app.

Database triggers queue alerts in the ride transaction. Repeated identical saves do not queue duplicates; rolled-back changes do not queue alerts. A private server worker checks current company membership, passenger ownership, ride status and driver assignment before delivery. Obsolete alerts are dropped. Failed delivery is retried up to five times within 15 minutes. Delivery is at least once: a crash after Google accepts an alert can cause a retry; notification tags replace the previous tray entry for that ride. FCM delivery and notification permission remain subject to Android and network conditions.

Only individually linked passenger accounts receive alerts. Group manifest members without a linked passenger login are not notification recipients. Existing ride rows are not backfilled. Trip updates come from existing app workflows; this worker does not assign rides or activate scheduled dispatch.

## Firebase setup completed

- Project `nemt-solutions`, number `992464989459`, created on the Spark no-cost plan with optional analytics and Gemini disabled.
- Owner verified in the Firebase permissions UI: `wahabmirza250@gmail.com`.
- Android app `com.redart.rides` registered as NEMT Passenger, app ID `1:992464989459:android:021d8d523c1828d3bebee6`.
- Cloud Messaging HTTP v1 enabled.

## Connection progress and remaining approvals

The user approved the official Firebase CLI connection for wahabmirza250@gmail.com. Sign-in succeeded and the real Android configuration was downloaded to the ignored google-services.json file. Capacitor synchronization includes the native push plugin. No server credential has been created yet.

Automatic approval review separately blocked creating the dedicated nemt-ride-notifications service account, granting roles/firebasecloudmessaging.admin in nemt-solutions, and generating its private key. That exact project permission and credential creation requires explicit approval. The key will be stored only in server-side Railway settings, not the APK or repository.

Saving the Android configuration as a GitHub Actions secret also needs a signed-in repository settings session. Automatic approval review blocked the GitHub sign-in because the specific GitHub account was not explicitly approved. The intended account is wahabmirza250, owner of the existing app repository.

## Finish after account authorization

1. Retrieve the registered Android app's genuine google-services.json. Store it as GitHub Actions secret `FIREBASE_PASSENGER_GOOGLE_SERVICES_JSON`; never commit it. The passenger build now fails clearly if this configuration is missing or targets another app/project.
2. Create a dedicated server service account with Firebase Cloud Messaging sending permission. Store its JSON only in Railway's server variable `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. Apply `supabase/migrations/20260926154448_passenger_ride_push.sql`. The new queue has RLS and no browser grants; its claim function is service-role only. No real rides are changed.
4. Publish server and web changes, then build passenger APK version 1.3 (versionCode 4). Native notifications cannot be enabled in an already-installed APK that omitted the native push plugin.
5. Install the new APK, sign in as the provisioned passenger, and allow notifications. Verify foreground, background and notification tap behavior on an actual device with an authorized test ride. Do not treat Firebase accepting a message as proof the device displayed it.

## Validation

- 1,111 app tests passed, including recipient ownership, company changes, stale arrival/reassignment suppression, retry behavior and safe notification destinations.
- TypeScript and production web build passed.
- 13 isolated PGlite checks passed for transactional queueing, repeated saves, tenant boundaries, cancellation deduplication, rollback, private access and leasing.
- Firebase configuration, signed FCM delivery and the new APK remain unverified until the account connection is approved.
