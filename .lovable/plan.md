
# Separate Driver + Passenger apps with live chat

Turn the current single site into three distinctly-branded apps sharing one backend, and add real-time chat between admin, drivers, and passengers.

## 1. Three branded surfaces, three links

| App | Link to share | Sign-in page | Who can register |
|---|---|---|---|
| Admin | `/admin` | `/admin/signin` | Only from dashboard |
| Driver | `/driver` | `/driver/signin` | Admin creates them |
| Passenger | `/rider` | `/rider/signup` + `/rider/signin` | Anyone (self sign-up) |

Each app gets its own logo/name/color accent so a driver opening `/driver` sees a driver-branded product, not the admin dashboard.

- Visiting `/driver` while signed out → driver sign-in page (not the shared `/auth`).
- Visiting `/rider` while signed out → passenger sign-in/sign-up.
- If a passenger tries the driver link, they're told "This link is for drivers" with a button to the passenger app (and vice versa).
- Signed-in users always land in their own app; wrong-role visits get bounced to the right one.

## 2. Passenger self sign-up

New public `/rider/signup` page: name, phone, email, password → creates auth user + `passengers` row automatically, then drops them into the passenger app. No admin action needed.

## 3. Driver accounts stay admin-created

Admin `Drivers` page gets a "Create driver login" button: enter email + temporary password → server function creates the auth user, `drivers` row, and `driver` role in one shot. You share the `/driver` link + credentials.

## 4. Live chat system (the big one)

New `conversations` + `messages` tables (Realtime enabled) with three conversation kinds:
- **Driver ↔ Admin** — always available
- **Passenger ↔ Admin** — always available
- **Driver ↔ Passenger** — auto-created when a trip goes active, auto-closed when trip completes (like Uber in-trip chat)

Where chat lives:
- **Driver app**: "Messages" tab — one thread with dispatch, plus per-active-trip thread with the passenger.
- **Passenger app**: "Messages" tab — one thread with support, plus per-active-trip thread with the driver.
- **Admin dashboard**: new `/messages` inbox — all conversations in one list, unread counts, search by name, live updates, reply from one place.

Chat features: text messages, read receipts, unread badge in each app's nav, sound/toast on new message when app is open, RLS so each side only sees their own threads.

## 5. Publish + PWA polish

- Publish the site so the three links actually work on phones.
- Update PWA manifest so installing from `/driver` shows "RedArt Driver" and from `/rider` shows "RedArt Rider" (separate app icons on the home screen).
- Keep the existing "Install app" prompt.

## Out of scope (say if you want any of these)

- Native App Store / Play Store builds
- Voice / video calls in chat
- File / photo attachments in chat (text only for v1)
- Custom domain (do that in Project Settings after publish)
- Changing any existing booking / tracking / earnings logic

---

## Technical notes (safe to skip)

- **Routing**: split `/driver` and `/rider` out of the shared `_authenticated` gate so each has its own auth flow. Add `driver/signin.tsx`, `rider/signin.tsx`, `rider/signup.tsx` as public routes; child routes stay protected by role checks.
- **DB migration** (`conversations`, `messages`, `conversation_participants`): RLS policies scoped via `has_role` + participant membership; GRANTs to `authenticated` and `service_role`; add both tables to `supabase_realtime` publication.
- **Auto-thread on trip**: trigger on `trips` — when status becomes `in_progress`, insert a driver↔passenger conversation; when `completed`, mark it closed (history stays visible).
- **Admin-creates-driver**: `createServerFn` with `requireSupabaseAuth` + `has_role('admin')` check, then dynamic `import('@/integrations/supabase/client.server')` to call Auth Admin API.
- **PWA per-app**: two manifest files (`/driver/manifest.webmanifest`, `/rider/manifest.webmanifest`) referenced from each app's route `head()`, distinct `name`, `short_name`, `theme_color`, icons.
- **Chat UI**: install AI Elements `conversation`, `message`, `prompt-input` primitives and reuse them for the human-to-human chat surface (message list + composer).
