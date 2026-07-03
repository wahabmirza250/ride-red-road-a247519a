## What you'll get

Three connected experiences on one codebase, all sharing the same database in real time:

1. **Admin dashboard** — you already have it. Gets new live tabs: active ride requests, drivers online, live map.
2. **Driver app** at `/driver` — mobile-first, installable.
3. **Passenger app** at `/rider` — mobile-first, installable.

Anyone visits the site, signs in, and is auto-routed to the right app based on their role (admin / driver / passenger).

## Passenger app (`/rider`)

- **Home** — big "Where to?" search, saved Home/Work chips, current location auto-fill.
- **Book a ride** — pick pickup + dropoff on map, see fare estimate + ETA before requesting.
- **Waiting screen** — live car icon moving toward you, driver name/photo/rating, minutes-to-arrival, "Cancel" and "Message driver".
- **In-trip** — live route line, ETA to destination.
- **Rate driver** — 1-5 stars + comment after trip.
- **Ride history** — list of past trips with fare + driver.
- **Saved places** — Home, Work, custom.
- **Entertainment tab** — games (uses your existing games system) + news feed so people stay in the app.

## Driver app (`/driver`)

- **Go online toggle** — starts GPS broadcast (already-built ping hook, upgraded to 5s while online).
- **Incoming request popup** — pickup address, distance, fare, Accept/Decline with countdown.
- **Active trip screen** — pickup → dropoff, passenger name, "Navigate" button (opens Google/Apple Maps), status buttons: Arrived → Start trip → Complete → Collect.
- **Earnings** — today, this week, all-time; hours online; trips completed.
- **Shift summary** at end of day.

## Live sync (the "Uber magic")

- Supabase Realtime channels on `trips`, `drivers`, `ride_requests`.
- Driver GPS writes to `drivers.current_lat/lng` every 5s while online.
- Passenger subscribes to their trip's driver row → car icon moves live.
- Admin dashboard subscribes to everything → sees all drivers + all active trips on the map.

## Installable (PWA)

- Web manifest + icons so both `/driver` and `/rider` show an **Install** prompt on phones.
- Opens fullscreen like a native app, gets its own home-screen icon.
- No offline mode (you didn't ask for it — keeps things simple and safe).

## Database changes

New tables:
- `ride_requests` — pending/accepted/rejected ride requests broadcast to nearby drivers
- `saved_places` — passenger's Home/Work/custom addresses
- `news_items` — admin-managed news feed for passenger entertainment tab

Extends existing tables:
- `drivers`: add `current_lat`, `current_lng`, `is_online`, `last_ping_at`
- `trips`: add `estimated_fare`, `estimated_arrival_at`, `passenger_rating`, `driver_rating`
- Enable Realtime publication on `trips`, `drivers`, `ride_requests`

New role: `passenger` (added to `app_role` enum; admin can also create passenger accounts).

## Admin dashboard additions

- **Live Ops** page: real-time map with every online driver (green = idle, blue = on trip), active ride requests, live trip cards.
- **News** page: create/edit news items shown to passengers.
- Driver creation form already sends email/password — extend the same to passengers.

## Out of scope for this turn

- Real payment processing (Stripe) — trips mark "Collect cash" for now. Say the word later and I'll wire Stripe.
- Turn-by-turn navigation inside the app — we hand off to Google/Apple Maps via a deep link (industry standard, avoids Mapbox nav SDK costs).
- Native iOS/Android builds — PWA covers 95% of the experience; Capacitor wrapper is a follow-up.
- Push notifications — needs Firebase Cloud Messaging setup; can add next turn if you want.

## Technical notes

- Fare estimate: haversine distance × configurable per-km rate + base fare (stored in a `pricing_config` row so you can edit it).
- ETA: straight-line distance ÷ avg 40 km/h until a routing API is added (Mapbox Directions is easy to bolt on later).
- Map: existing Leaflet setup extended with driver marker updates on realtime events.
- Role routing: `/` redirects → admin → `/dashboard`, driver → `/driver`, passenger → `/rider`.
- All new tables get RLS: passengers see only their own rides, drivers see only assigned rides + open requests, admin sees all.

## Build order

1. DB migration (tables, columns, realtime, RLS, roles)
2. Passenger booking flow + live tracking
3. Driver online/offline + request accept + trip lifecycle
4. Admin Live Ops page + News management
5. PWA manifest + install prompt
6. Role-based routing polish

Approve and I'll ship it.