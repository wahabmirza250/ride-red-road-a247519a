# App review fixes — release checklist

This branch addresses the 25 September review. It is not deployed. Production database changes and activation of the scheduled-dispatch worker were blocked by automatic approval review and require explicit approval.

## Included

- Prevent self-service company membership changes and client-side role assignment; bind role checks to the current active company. The SQL migration is tested locally, not applied in production.
- Require authenticated, company-scoped ride access for tracking, cancellation, redispatch and offer lifecycle operations. Scope legacy passenger bookings, ride history and group requests. Reject unscoped staff notification broadcasts.
- Separate each company's automatic dispatch setting. Match only fresh GPS, on-duty status and exact vehicle type. Hold future requests until within 15 minutes of pickup; leave groups for manual capacity review. Preserve an active offer and compare current assignment before replacing it.
- Owner-managed company support phone during creation and on existing profiles. Passenger Safety and dispatch support read that company-specific number. Missing numbers are not callable placeholders.
- Foreground video-only recording in independent 30-second clips, a bounded persistent upload queue, private company-scoped playback and seven-day expiry. Renewed agreement is required. A live-video outage no longer blocks work while local recording remains healthy. Recording failure or a full queue still blocks use.
- Server cleanup every 15 minutes, with retry after failure. Expired clips cannot receive new playback links. Local pending footage is expired when the queue runs; app closure can lose the current clip. This is not background recording.
- Native push token registration/removal, tenant-aware delivery and Firebase HTTP v1 integration. Locked-screen alerts contain no passenger details. Native plugin inclusion is conditional on each app's Firebase configuration file.
- Simplified billing setup/insight sections; working billing message entry; removed unfinished notification-preferences action; scoped passenger referral/photo storage; clearer booking guidance and profile prefill; consistent branding/menu labels and sampled accessibility fixes.

## Still requires external setup or device validation

- SMS provider credentials/sending number and verification, plus actual billing provider and portal configuration. These cannot be fabricated; submission stays blocked until configured.
- Firebase configuration for both APKs and the server-only Firebase service-account secret. A build without Firebase remains usable but has no native background push.
- Actual fleet tablet: recording/playback, Wi-Fi interruption/recovery, queue capacity, permission denial, app hiding/sign-out, screen rotation, long-running battery/thermal behavior and foreground/background notification delivery.
- One authorized complete ride with trip evidence and billing review. No real ride, SMS, claim or payment was submitted during this fix pass.
- Full authenticated local UI testing requires server credentials. Local entry and revised privacy page were inspected; unit and build checks do not replace authenticated/device tests.

## Database migration blast radius

`supabase/migrations/20260925211623_app_review_security_and_recordings.sql` revokes browser writes to `user_roles` and restricts profile updates to editable personal fields. Guarded service-role account management continues to work. It changes `has_role` and `current_user_has_role` to require matching active company membership, restricts namespaced company settings, creates private recording and native-push tables, and creates the private `vehicle-recordings` bucket. No customer rows or accounts are deleted by this migration.

Legacy global auto-assign settings are not copied. Each company administrator explicitly enables their own setting. Existing link-only guest tracking is replaced with account ownership; passengers sign in and use My rides.

## Scheduled automatic dispatch — not activated

`src/lib/scheduledDispatch.server.ts` is prepared but is not imported by the server. Activation would check pending scheduled rides once per minute, consider only the last hour through the next 15 minutes, respect each company's auto-assign switch and eligibility rules, and suppress repeated no-driver alerts. It can assign rides and notify drivers, so activation awaits explicit approval.

## Validation

- Full TypeScript check, production web build and automated suite: see review task results for the final run.
- Isolated PostgreSQL-compatible fixture: 11 permission/storage checks passed, including denied company reassignment, denied owner-role injection, allowed profile edits, cross-company settings isolation and private recording/token tables.
- New unit tests cover ride ownership/role boundaries, dispatch eligibility and pickup timing, recording queue account separation/expiry/capacity, and cleanup retry after storage failure.

## Publication order

1. Approve and apply the reviewed database migration; verify privileges, role behavior, bucket privacy and advisors.
2. Publish the web changes and verify company sign-in and role-specific workflows.
3. Configure providers and Firebase through secure settings, then build/update the APKs and perform tablet tests.
4. Activate recurring scheduled dispatch only if separately approved.

OTP remains a separate pending choice: delivery channel and whether it replaces or supplements passwords have not been selected.
