# RedArt LLC — NEMT Platform Plan

## Architecture (adapted to Lovable)

The original spec assumes Node/Express + SQLite + Socket.io + React Native. Lovable can't run any of those. Here's the equivalent that delivers the same behavior:

| Original | Lovable equivalent |
|---|---|
| Node + Express + SQLite + Sequelize | **Lovable Cloud** (Postgres + auto-generated REST/RPC) with server functions (TanStack Start) for custom logic |
| JWT auth, bcrypt, 3 roles | Supabase Auth (email/password) + a `user_roles` table with `admin`/`driver`/`passenger` enum + `has_role()` security-definer function |
| Socket.io rooms | **Lovable Cloud Realtime**: Postgres change streams for trip/driver/message updates + broadcast channel `driver:{id}` for live GPS pings |
| Multer + `uploads/` folder | Lovable Cloud **Storage buckets**: `profiles`, `odometers`, `receipts`, `inspections`, `incidents` |
| CRA admin + 2 React Native apps | **3 separate Lovable projects** sharing one Cloud backend: Admin (desktop web), Driver (mobile PWA), Passenger (mobile PWA) |
| localStorage / AsyncStorage tokens | Supabase session (handled by SDK) |
| Notification permission (RN) | Web Notifications API + PWA manifest |
| React-Leaflet + OSM | Same — React-Leaflet + OpenStreetMap tiles |
| React Native Maps | React-Leaflet in the PWAs |
| Expo ImagePicker | `<input type="file" accept="image/*" capture="environment">` |

Everything else — data model, business rules, trip state machine, Haversine auto-assign, payroll @ $15/hr, GPS stop detection, 12-item inspection, Medicaid ID lookup, ESPN feed, printable payroll — carries over unchanged.

## Design system (shared across all 3 apps)

- **Apple-style modern UI**: near-white surfaces, generous whitespace, rounded-2xl cards, soft shadows, SF Pro Display-inspired typography (Inter Display + Inter), subtle spring animations, `backdrop-blur` sheets and nav bars, iOS-style segmented controls and switches.
- **Shared design tokens package**: same `styles.css` (oklch tokens), same Tailwind config, same primitive components (Button, Card, Sheet, Segmented, StatCard, MapCard) copied into all three projects so they look identical.
- Admin: light desktop-optimized layout. Driver + Passenger: mobile-first PWA shells (safe-area insets, bottom tab bar, pull-to-refresh feel, installable to Home Screen).

## The three projects

### Project 1 — RedArt Admin (this project)
Desktop web app. Screens: Login, Dashboard (stats + live driver map + activity feed + toasts), Trips (table + filters + detail modal + New Trip + Auto-Assign), Drivers, Passengers, Billing, Messages/Dispatch, Reports (with printable payroll export in a new tab), Incidents, Schedules.

### Project 2 — RedArt Driver (new Lovable project, shared backend)
Mobile PWA, installable. Dark GitHub-style (~#0d1117) per your original spec — this one stays dark; Admin + Passenger get the light Apple look. Screens: Login, Home (online toggle + active trip banner + stats + quick-action grid), My Trips, Active Trip (full state machine: en-route → arrived → odometer photo → confirm passenger → driving with waypoints + 5s GPS ping → odometer end → rate passenger → complete), Dispatch, Schedule, Fuel Log, Inspection, Report Incident, Profile.

### Project 3 — RedArt Passenger (new Lovable project, shared backend)
Mobile PWA. Screens: Book a Ride (Medicaid ID lookup auto-fills, otherwise editable), Booking Confirmed (scale-in animation), Track Driver (live map + status-driven headline + call button, subscribes to `driver:{id}` broadcast + 15s polling fallback), Live News/Sports tab (ESPN scoreboard + news APIs, 60s refresh).

## Data model

Postgres tables with RLS, all with `id uuid`, `created_at`, `updated_at`:

`profiles` (mirrors `auth.users`, holds first/last/phone/is_active), `user_roles` (enum: admin/driver/passenger), `drivers`, `passengers` (unique medicaid_id), `trips` (with `gps_route jsonb[]`, waypoints jsonb, status enum for the full flow), `billing_records`, `messages`, `shifts`, `fuel_logs`, `inspections` (jsonb checklist, unique on driver+date), `incidents`.

Every public table gets explicit `GRANT`s + RLS policies scoped by role via `has_role()`. Passenger tracking uses a narrow `TO anon` policy on a safe projection so `/trips/public/:id` works without auth.

Seed migration: admin user `admin@redartllc.com`, driver `driver1@redartllc.com`, one sample passenger.

## Server functions & routes

- CRUD via Supabase client where RLS covers it (drivers/passengers/trips/billing/etc.)
- Server functions (`createServerFn` + `requireSupabaseAuth`) for: `auto-assign` (Haversine), `payroll` (hours × $15 + fuel + trips), `dashboard-stats`, `send-message` + realtime broadcast, `payroll-export` (returns HTML for the new-tab print view), `stop-detection` (>2 min, <0.001° movement) for the Reports GPS map.
- Public server route `/api/public/trips/:id` for passenger tracking (no auth, safe columns only).
- Storage upload helpers for the six photo endpoints.

## Realtime plan

- **Trip status changes** → Postgres change stream on `trips` table → admin dashboard toast + activity feed, driver's my-trips list, passenger's tracking headline all update automatically.
- **Driver GPS (5s pings)** → Driver PWA sends broadcast on `driver-locations` channel with `{driver_id, trip_id, lat, lng, ts}`. A server function subscribes and (a) updates `drivers.current_lat/lng`, (b) appends to `trips.gps_route`. Admin map + passenger tracking subscribe to the same channel for zero-lag rendering.
- **Chat** → change stream on `messages` filtered by `driver_id`.

## Business rules baked in

Trip state machine enforced in the update RPC. `complete` blocked without both odometer photos. Auto-assign Haversine with first-available fallback. GPS stop detection @ 2 min / 0.001°. Rating averaging via trigger on `trips`. One inspection per driver per day via unique constraint. Payroll prefers shift hours, falls back to trip durations. Every passenger record requires `medicaid_id NOT NULL`.

## Build phasing (all four, in order)

```text
Phase 1 — Foundation (this project = Admin)
  Cloud on • schema + RLS + grants + seeds • Auth + roles + guards
  Admin shell + design system • Trips/Drivers/Passengers CRUD
  Live driver map + realtime driver_moved + trip_status toasts
  Auto-assign • Billing • Messages • Reports + printable payroll
  Incidents • Schedules
  → Deliver Admin end-to-end, verify with browser tests

Phase 2 — Driver PWA (separate Lovable project, points at same Cloud)
  Copy design tokens (dark theme variant) • PWA manifest + install
  Auth • Home + online toggle • My Trips • Active Trip full flow
  GPS ping loop • Camera capture for odometers/fuel/inspection/incident
  Dispatch chat • Schedule view • Fuel Log • Inspection • Incident • Profile

Phase 3 — Passenger PWA (separate Lovable project)
  Copy design tokens (light Apple variant) • PWA manifest
  Book a Ride + Medicaid lookup • Booking Confirmed animation
  Track Driver (realtime + polling fallback) • ESPN news/sports tab

Phase 4 — Polish across all 3
  Toasts + notifications • PWA install prompts • Empty/error states
  Payroll PDF print styling • Accessibility pass • Final QA
```

## What you should expect

- Phase 1 lands in this project. Phases 2 and 3 happen in two new Lovable projects I'll ask you to create (or you can create them and invite me in); they point at the same Lovable Cloud instance so all three apps share data live.
- This is a large build. I'll ship in working slices, verify each with the browser, and iterate. It won't be one-shot perfect — expect ~a dozen review-and-refine cycles across the four phases.
- Third-party accounts you'll need: none for Phase 1. If you later want SMS or push, that's Twilio/APNs and we'd add it then.

## What I need from you to start

1. **Confirm this plan.** Approve and I'll begin Phase 1 immediately.
2. **After Phase 1 is done**, create two new Lovable projects named "RedArt Driver" and "RedArt Passenger" and mention them in chat — I'll wire them to this project's Cloud backend and continue.

## Technical appendix

- Stack: TanStack Start (React 19 + Vite 7) on Cloudflare Workers, Tailwind v4, shadcn/ui primitives, Lovable Cloud (Postgres + Auth + Storage + Realtime), React-Leaflet.
- Auth: Supabase email/password, `_authenticated` route layout, `has_role(uuid, app_role)` security-definer function driving RLS.
- Realtime: Postgres change streams (`postgres_changes`) + broadcast channels (`driver-locations`, `driver:{id}`, `admin-events`).
- File uploads: Supabase Storage signed URLs. Bucket policies restrict writes by role and reads to trip participants.
- Payroll export: server function returns a self-contained HTML document opened in a new tab with `window.print()` styling; user saves as PDF from the browser.
- ESPN: `site.api.espn.com/apis/site/v2/sports/...` scoreboard + news endpoints, fetched client-side, 60s refetch.
- Stop detection: server function scans `trips.gps_route`, groups consecutive points within 0.001° that span >120s, returns cluster centroids for the Reports map.
