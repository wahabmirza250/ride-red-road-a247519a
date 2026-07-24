# What just shipped (privacy leak)

The passenger ride-history leak is a distinct bug from the session-sharing one you flagged earlier. Root cause:

- `lookupPassengerRides` was a **public** endpoint (no auth) that used the service-role client, bypassed RLS, and matched by **fuzzy phone suffix** (`ilike '%last-7-digits%'`). Anyone could pass any phone / Medicaid ID and receive another passenger's trip details.
- `/passenger/track` auto-fired that lookup with phone / Medicaid ID cached in `localStorage`. On a shared device (or a device whose `localStorage` still had a previous value), a fresh visitor saw whichever passenger had used the page last.
- RLS on `passengers`/`trips` is correct; `passenger.index.tsx` already scoped to the signed-in user. Not related to the session-sharing bug.

Fixed:
1. `lookupPassengerRides` now requires `requireSupabaseAuth`, ignores any phone/Medicaid input, and returns only trips where `passengers.user_id = auth.uid()` — RLS enforces the same scope as defense-in-depth.
2. `/passenger/track` now requires sign-in and calls that scoped endpoint. It clears any lingering `passenger_phone` / `passenger_medicaid` values from `localStorage` on mount.
3. The signed-in home page (`passenger.index.tsx`) was already correct.

I couldn't run two-passenger cross-device verification from the sandbox (no test passenger credentials injected). The change makes cross-passenger read structurally impossible: the endpoint no longer accepts identifying inputs, and RLS on both `passengers` and `trips` is scoped to `auth.uid()`.

# Plan for the admin operational-control request

This is 4 sub-features. Some questions before I build:

## 1. Fix the admin dashboard map
Investigate why the map on `/dashboard` isn't rendering. Likely candidates: Google Maps loader failing silently, the fleet map component crashing, or a missing driver-location fallback. Fix root cause, verify by loading the dashboard as an admin.

## 2. Add an "Activity" section — all active drivers
New card/tab on the dashboard (or a new `/live-ops` sub-view — see question below) listing every driver whose `status` is `available` or `busy`. Click a row to open a side panel showing:
- Live location (last known `current_lat/current_lng`, timestamp of last ping)
- Current trip assignment (pickup, dropoff, passenger name, status) if any
- Status pill (available / busy / offline)
- Quick actions: message driver, cancel current trip, reassign current trip

## 3. Admin control over in-progress trips
- **Reassign mid-trip**: `adminReassignDriver` already exists — surface it from the driver detail panel and from the trip detail sheet on `/trips` and `/live-ops`, with a driver picker showing distance + availability.
- **Admin cancel**: new `adminCancelTrip` server function (admin-only via `has_role`) that sets `trips.status = 'cancelled'`, frees the driver back to `available`, and cancels the parent `ride_requests` row. Confirm dialog before firing.
- **Manual assign of pending request**: new `adminAssignPendingRequest` that admins call on any `ride_requests` still in `pending` (including the dispatch-fallback "no drivers available" case). Picks a driver, creates the trip, marks the request `assigned`.

## 4. Notifications overhaul
Rework the bell so each notification is actionable and typed:
- `pending_dispatch` — new ride waiting for a driver (link → Live Ops)
- `dispatch_stuck` — declined by ≥3 drivers or pending >5 min (link → the ride, with "Assign manually" CTA)
- `incident_reported` — link → the incident detail
- keep existing `signup` / `driver_status` but re-style with clear iconography and one-click action buttons where relevant

Adds a `severity` column (`info` / `warn` / `urgent`) and a background trigger for the `dispatch_stuck` case (either DB trigger on decline count / age, or a small poll in the admin app).

# Questions before I start

1. Where should the Activity tab live? A new section on `/dashboard`, an expansion of the existing `/live-ops` page, or its own top-level `/activity` route?
2. For admin cancel, should the passenger get a push notification explaining dispatch cancelled their ride, or is a silent cancel fine?
3. For `dispatch_stuck` detection, is a 5-minute pending threshold correct? And should "declined by N drivers" count decline events even if new drivers are still being tried?
4. Anything else specific you want in the driver detail panel (recent trips, today's earnings, incident count, etc.)?

Reply with answers (or "you decide") and I'll build all four in one pass and verify end-to-end as admin.
