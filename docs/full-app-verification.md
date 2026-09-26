# App verification — 26 September 2026

Status: local fixes verified; not deployed or signed off for production. Branch `fix/full-app-audit` starts from the production-equivalent `25decd7` tree. Passenger native push work remains on a separate branch.

## Changes

- Removing dispatch or billing access preserves the shared login and its other app roles. Shared/self driver-account deletion is blocked.
- Events, games, news, rewards settings, entrants, winners, and notification recipient selection are scoped to the current company. Account changes clear cached query results.
- Driver ride completion verifies the current role, company, assignment, and linked request before mutation. Completion, cancellation, and rescheduling update linked records in one database transaction. Another active trip prevents premature driver availability.
- Reward draws run in a serialized transaction to prevent duplicate draws for a company and period.
- Pickup estimates exclude stale GPS and drivers without a current shift.
- Passenger Events handles unavailable browser notification APIs and query errors. Event date validation rejects invalid or reversed times.
- Billing Settings includes provider selection. Passenger profile fields have improved label associations. Passenger news decodes HTML space entities.

## Validation completed

- 1,124 Vitest tests passed, zero failures.
- TypeScript validation and production build passed.
- 43 isolated PostgreSQL fixture checks passed: company content isolation (18), dispatch actions and rollback (14), company rewards (11). These fixtures are not a full production migration rehearsal.
- Whitespace validation passed.

## Live interface coverage

These observations concern the current production version, not the locally fixed version. Opening an empty screen is not proof that all its operations work.

- Admin: dashboard and setup links; event creation validation; driver pay expansion and hours dialog; driver/passenger creation dialogs; schedule week navigation; trip creation validation; compliance, reports, incidents, team, messages, SMS status refresh, announcements, games, rewards, and live operations. No accounts were created or removed, messages sent, or financial data changed.
- Passenger: home and location fallback, booking validation, empty ride list, profile verification-mode toggle, More menu, Events, Games, Rewards, and Local News. No ride was submitted or profile saved.
- Dispatch: today board, schedule-ride dialog, route builder and empty-route validation, schedule, history, and planned rides. No real ride was dispatched.
- Billing: work queue filters, settings validation, batch-upload empty state, paper bills landing, and messages. No claim, payment, upload, or payer submission was exercised.
- Driver: sign-in reached the privacy/camera agreement. Camera permission and agreement were not accepted on behalf of a driver; subsequent driver controls were not tested live.
- Owner: no owner role was available for live testing.

## Required before full release sign-off

1. Rehearse all three new migrations against a staging copy, then test the fixed build with authenticated users from two separate companies. The local environment lacks the privileged server credential required for full authenticated browser tests.
2. Run a test ride through booking, assignment, arrival, pickup, signature, completion, cancellation, rescheduling, and billing. Exercise populated row actions and confirm refresh/reconnection behavior.
3. Test owner company creation and issued app credentials with an owner account.
4. Finish account lifecycle review: driver-only deletion and some account-creation handlers still contain separate writes with incomplete failure handling. The shared-account safeguard does not make those flows transactional.
5. Select the Android device, then test APK cold start, actual screen sizes, camera, GPS, navigation handoff, interrupted connections, background/resume, recording retention, and notification delivery. Browser viewport override did not change the observed 1280×720 viewport, so phone/tablet layouts are not certified by this pass.
6. Complete external setup for native push, SMS, and the billing provider where required. Native push credentials and APK validation remain incomplete. Scheduled automatic dispatch activation also remains pending.

## Release notes

Apply the content, dispatch, and rewards migrations before deploying code that uses their columns/functions. Review existing global content before assigning legacy rows to companies; unattributable legacy news/game rows are intentionally not exposed to all tenants. Existing global rewards configuration is copied to company settings.

No database migrations or app changes from this audit were applied to production. Do not represent this checklist as an all-buttons pass or a guarantee of no bugs.
