## What you'll get

### 1. Email + password login (back on)
- Restore the real sign-in screen (email + password), remove the "email only" bypass.
- Passengers can self‑signup (email + password) from the passenger app.
- Drivers can NOT self-signup — admin creates them.
- Admin can create accounts from the dashboard (drivers or passengers) with an email + password you set. No email verification required (auto‑confirm stays on).

### 2. Passenger profile system
- The existing `/passenger/profile` form is already there — I'll wire it to the logged‑in account (not just the device) so the profile follows the user across devices, and pre-fill from signup.
- Ride booking pre-fills from the profile.

### 3. Events (party / free food / etc.)
- New admin page **/dashboard → Events**: title, description, date/time, location (address + map pin), optional image, "active" toggle.
- Passenger app gets a new **Events** tab (replaces or joins the News tab) showing active events with image, details, and a big **Book a ride** button that opens the booking form with the event location pre-filled.
- When admin publishes an event, every passenger who has enabled notifications gets a push: *"Free food today at 6pm — tap to book a ride."*

### 4. Strong notifications
**To passengers** (in‑app + browser push, PWA):
- New event published

**To admin** (in‑app + browser push, works with dashboard tab closed):
- New ride request from a passenger (loud sound + red banner)
- New passenger signs up
- Driver goes online/offline
- Driver accepts a trip

All admin notifications also show in a bell‑icon feed in the dashboard header with unread count and a distinct alert sound for new ride requests.

## Technical section

**Auth**
- `src/routes/auth.tsx`: restore email+password form (sign in + sign up tabs). Remove `derivePassword` bypass.
- `src/routes/driver.signin.tsx`: email+password only, no signup link.
- New `/dashboard/team` action "Create user" → server fn `adminCreateUser` using `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } })`, plus role grant in `user_roles`. Admin‑role checked via `has_role`.

**DB migration**
- `events` table: `id, title, description, starts_at, ends_at, location_address, location_lat, location_lng, image_url, is_active, created_by, created_at, updated_at`. RLS: anyone authenticated can `SELECT` active; admin can insert/update/delete. GRANTs to `authenticated` + `service_role`.
- `push_subscriptions` table: `id, user_id, endpoint, p256dh, auth, user_agent, created_at`. RLS: user owns rows; admin can read all (to fan out). Unique on `endpoint`.
- `admin_notifications` table: `id, kind, title, body, data jsonb, read, created_at`. RLS admin‑only. Realtime enabled.
- Enable realtime for `events`, `admin_notifications`, `ride_requests`, `drivers` (status column) — used for live bell feed.

**Web Push (PWA)**
- Add `web-push` on server side, generate VAPID keys via `generate_secret` (public + private) — public key exposed as `VITE_VAPID_PUBLIC_KEY`.
- New service worker `public/push-sw.js` (separate from any existing SW) that handles `push` events and shows notifications.
- Client helper `src/lib/push.ts`: register SW, `Notification.requestPermission()`, `pushManager.subscribe({ applicationServerKey })`, store subscription via `saveSubscription` server fn.
- Server fn `sendPushToUsers(userIds, payload)` reads subscriptions and calls `web-push.sendNotification` for each.
- Passenger app prompts for permission on first visit after signup; admin dashboard prompts on first load.

**Event fan‑out**
- Server fn `publishEvent` → insert + call `sendPushToUsers(all_passenger_user_ids, {title, body, url:'/passenger/events'})`.

**Admin realtime alerts**
- Dashboard root component subscribes to `ride_requests` (INSERT), `profiles` (INSERT for new signups), `drivers` (UPDATE on status), and inserts a row into `admin_notifications`. A bell dropdown reads latest 20 with unread count. Ride‑request inserts play a loud sound (embedded base64 mp3) and show a red toast; also trigger `sendPushToUsers(admin_user_ids, …)` via a DB trigger‑backed server fn call (server fn invoked from the same INSERT handler on the client that placed the request, so no cron needed).

**Files touched (approx)**
- Edit: `src/routes/auth.tsx`, `src/routes/driver.signin.tsx`, `src/routes/_authenticated/team.tsx` (add "Create user"), `src/routes/_authenticated/dashboard.tsx` (bell + realtime), `src/routes/passenger.tsx` (nav + push prompt), `src/routes/passenger.apply.tsx` (accept `?eventId=`), `src/routes/__root.tsx` (register push SW).
- Create: `src/routes/_authenticated/events.tsx`, `src/routes/passenger.events.tsx`, `src/lib/events.functions.ts`, `src/lib/push.functions.ts`, `src/lib/push.ts`, `src/lib/adminNotifications.functions.ts`, `src/components/admin/NotificationBell.tsx`, `public/push-sw.js`.
- Migration for `events`, `push_subscriptions`, `admin_notifications` + realtime.
- Secrets via `generate_secret`: `VAPID_PRIVATE_KEY`; publishable `VITE_VAPID_PUBLIC_KEY` committed.

## Scope confirm

This is ~10–14 files + 1 migration + 1 npm package (`web-push`). No SMS, no Twilio, no email provider needed. I'll ship it end‑to‑end in the next step.

Ready to build?
