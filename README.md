# RedArt Colorado Ride Connect

# RedArt LLC — Colorado NEMT Platform

I want to build a complete Non-Emergency Medical Transportation (NEMT) platform for my company, RedArt LLC. We run Medicaid transportation trips in Colorado, and right now everything is tracked on paper — I want to replace that with real software.

The platform needs three connected apps sharing one backend:

1. **Admin Dashboard** — a React.js web app for dispatch and management
2. **Driver App** — a React Native mobile app for drivers
3. **Passenger App** — a React Native mobile app for riders to book and track their trips
4. **Backend API** — Node.js/Express with SQLite and Socket.io for everything real-time

Here's the full picture of how it should work.

---

## Tech stack

Build the backend with **Node.js + Express**, using **SQLite through Sequelize** as the ORM (please use `sequelize.sync()` for setup — not `alter: true`, since I don't want it silently changing my schema). Auth should run on **JWT**, with three roles: `admin`, `driver`, and `passenger`. For live updates use **Socket.io** with rooms — one room per driver (`driver:{driverId}`) and one shared `admin_room`. File uploads (photos, receipts) go through **Multer**, saved into an `uploads/` folder and served statically. Passwords should be hashed with **bcryptjs**, and config should come from a `.env` file via **dotenv**.

The **admin dashboard** is a Create React App project using **React Router v6** for navigation, **Axios** for API calls, **React-Leaflet with OpenStreetMap** for the live map, and **Socket.io-client** for real-time updates.

The **driver and passenger apps** are **React Native** (Expo is fine) using **React Navigation** (stack + bottom tabs), **Axios**, **Socket.io-client**, **React Native Maps**, and an image picker (Expo ImagePicker or react-native-image-picker) for photo uploads.

---

## The data model

Here's what needs to be stored. I'll describe each table and its fields in plain terms — please implement these as Sequelize models with UUID primary keys and `createdAt`/`updatedAt` timestamps unless noted otherwise.

**User** — the login identity for everyone in the system: email (unique), hashed password, first name, last name, role (`admin` / `driver` / `passenger`), phone, and an `is_active` flag.

**Driver** — linked to a User, holds license number, vehicle details (make, model, year, plate, color), current status (`available` / `on_trip` / `offline`), live GPS coordinates (`current_lat`, `current_lng`), a profile photo URL, and rating info (`rating`, `total_ratings`, `total_trips`).

**Passenger** — the Medicaid riders: name, date of birth, phone, email, a **unique Medicaid ID**, county, address, notes, and an active flag.

**Trip** — the core object. Links a driver (nullable — trips can start unassigned) and a passenger. Has a status that moves through a defined flow (more on that below), pickup and dropoff addresses, an optional JSON array of waypoint addresses for multi-stop trips, scheduled vs. actual pickup/dropoff times, odometer readings (start, end, computed miles), GPS-computed miles, the full GPS route as a JSON array of `{lat, lng, ts}` points, photo URLs for the start/end odometer photos, a billing status, an optional passenger rating (1–5) with a note, general notes, a flag/reason for problem trips, whether it was assigned manually or automatically, an HCPF claim number, and a "patient confirmed" flag with timestamp.

**BillingRecord** — one per trip: amount, service code, diagnosis code, units, rate per unit, status, and submitted/paid timestamps.

**Message** — a simple driver ↔ admin chat log: sender ID and role, receiver ID, which driver the thread belongs to, message body, and a read flag.

**Shift** — a scheduled block of time for a driver: date, start time, end time, notes, and status (`scheduled` / `completed` / `no_show`).

**FuelLog** — driver fill-ups: date, gallons, cost per gallon, total cost, odometer, station name, and a receipt photo.

**Inspection** — one pre-trip vehicle check per driver per day: a JSON array of 12 checklist items (lights, brakes, tires, mirrors, seatbelts, fuel, oil, windows, first aid kit, interior, insurance, phone), overall pass/fail, notes, and an optional photo.

**Incident** — driver-filed reports: type (`accident` / `late` / `no_show` / `complaint` / `mechanical` / `other`), description, optional photo, status (`open` / `reviewed` / `closed`), and admin notes.

---

## Backend API

Please build these REST endpoints (returning JSON, obviously):

**Auth** (`/api/auth`)
- `POST /login` — email + password in, `{token, user}` out
- `GET /me` — return the logged-in user from their JWT

**Drivers** (`/api/drivers`)
- `GET /` — all drivers, with their User info joined in
- `GET /:id` — one driver
- `POST /` — create the User and Driver profile together in one call
- `PUT /:id` — update driver fields
- `PUT /:id/status` — set online status
- `POST /:id/photo` — upload profile photo (multipart, field name `photo`)
- `GET /:id/location` — current lat/lng

**Passengers** (`/api/passengers`)
- `GET /`, `GET /:id`, `POST /`, `PUT /:id` — standard CRUD
- `GET /lookup/:medicaidId` — look a passenger up by Medicaid ID (this is what powers the "look up my ride" flow in the passenger app)

**Trips** (`/api/trips`)
- `GET /` — with filters for status, driver, passenger, date range, and billing status
- `GET /:id` — one trip with driver/passenger/billing joined in
- `GET /public/:id` — an unauthenticated version for passenger trip tracking
- `GET /driver/:driverId` — a driver's trips for today
- `POST /` — create a trip (driver, passenger, pickup/dropoff, waypoints, scheduled time)
- `PUT /:id/status` — move the trip through its status flow; this should auto-stamp `actual_pickup_time` and `actual_dropoff_time` at the right moments
- `PUT /:id/odometer-start` and `PUT /:id/odometer-end` — upload odometer photos (multipart)
- `PUT /:id/rate-passenger` — driver rates the passenger 1–5 with an optional note
- `PUT /:id/waypoints` — update the stop list
- `POST /auto-assign` — given a trip ID, find the nearest available driver using the Haversine formula and assign them, then emit `driver:new_trip_assigned` over the socket
- Support a `?gps_route=true` query param to include the full GPS trail when needed

**Admin** (`/api/admin`)
- `GET /dashboard-stats` — trips today, active drivers, pending billing, completed today
- `GET /users`, `POST /users`, `PUT /users/:id`
- `GET /payroll/:driverId` — this is the important one. Pull completed trips, shifts, and fuel logs for the driver, calculate hours worked (from shifts if scheduled, otherwise fall back to summing trip durations), pay at **$15/hour**, add up fuel reimbursements from the fuel logs, and return the whole breakdown plus a total.

**Messages** (`/api/messages`)
- `GET /:driverId` — the thread with one driver (marks it read)
- `GET /` — admin view: every driver with their latest message and unread count
- `POST /` — send a message, and push it live over the socket to the right room

**Shifts** (`/api/shifts`)
- `GET /` (filter by driver/week), `POST /`, `PUT /:id`, `DELETE /:id` — admin manages the schedule

**Fuel** (`/api/fuel`)
- `GET /` (filter by driver), `POST /` — driver logs a fill-up with an optional receipt photo

**Inspections** (`/api/inspections`)
- `GET /` (filter by driver/date), `POST /` — driver submits the daily checklist

**Incidents** (`/api/incidents`)
- `GET /` (filter by status/driver), `POST /`, `PUT /:id` — admin resolves them

**Billing** (`/api/billing`)
- `GET /` (filter by status/driver/date range), `PUT /:id` — review and update billing records

---

## Real-time behavior (Socket.io)

**From server to clients:**
- `admin:driver_moved` — a driver's GPS updated, broadcast to `admin_room`
- `admin:trip_status_changed` — broadcast whenever a trip's status changes
- `admin:all_driver_locations` — sent in response to an admin requesting current positions
- `driver:new_trip_assigned` — sent to that driver's personal room
- `chat:new_message` — sent to whichever room (admin or a specific driver) needs it

**From clients to server:**
- `driver:join` — driver joins their personal room on connect
- `admin:join` — admin joins the shared room
- `driver:location_update` — every 5 seconds while a trip is active, the driver app sends `{driver_id, trip_id, lat, lng, ts}`; the server appends this to the trip's `gps_route` and rebroadcasts it to admin
- `admin:request_driver_locations` — admin asks for everyone's current position

---

## Auth rules

JWT secret comes from the environment, tokens last 7 days, and get stored in localStorage on web / AsyncStorage on mobile, sent as `Authorization: Bearer <token>`. Middleware needed: `requireAuth` (any valid token), `requireAdmin`, `requireDriver`. Seed a default admin (`admin@redartllc.com` / `admin123`) and a default driver (`driver1@redartllc.com` / `driver123`) so I can log in right away.

---

## Admin Dashboard — what each screen should do

**Login** — email/password, store the JWT on success, show an error on bad credentials.

**Dashboard (home)** — stat cards for trips today, active drivers, pending billing, and completed trips. A live OpenStreetMap map with color-coded driver markers (green = available, blue = on trip, gray = offline) that move in real time as GPS updates come in over the socket. Clicking a marker shows the driver's name and status. Below that, an activity feed of the last 10 trip status changes, and toast notifications that slide in from the top-right whenever a trip status changes, auto-dismissing after 10 seconds.

**Trips** — a filterable table (status, billing status, date range) with columns for date/time, driver, passenger, pickup, dropoff, and status/billing as colored pills. Clicking a row opens a modal with the full trip detail, including the odometer photos. A "+ New Trip" button opens a modal to pick a driver, search for a passenger by name or Medicaid ID, enter pickup/dropoff addresses, optionally add intermediate stops, and set the scheduled pickup time. There's also an "Auto-Assign" button that grabs the next unassigned scheduled trip and runs the auto-assign logic.

**Drivers** — a list with status dots, vehicle info, and rating. Clicking a driver opens an edit panel (name, vehicle info, license, status), and there's an "add driver" flow too.

**Passengers** — a searchable list showing Medicaid ID, county, and phone. Clicking one opens an edit panel; there's also an "add passenger" flow with the full field set including Medicaid ID.

**Billing** — a table of billing records tied to completed trips, filterable by status, with an edit view for status, service code, diagnosis code, units, and rate.

**Messages (Dispatch)** — a two-pane layout: driver list on the left with unread badges and status dots, chat thread on the right (admin messages right-aligned, driver messages left-aligned), updating live over the socket, with the unread badge clearing when you open a thread.

**Reports** — pick a driver on the left, a date range on the right (today / last 7 days / all time), and see trips completed, miles driven, hours active, and earnings at $15/hr. An "Export Payroll" button opens a clean, printable payroll summary in a new tab (driver name, period, earnings breakdown, shifts table, grand total, and a print/save-as-PDF button). Below that, a GPS route map with a blue polyline for the route and red dots marking detected stops (anywhere the driver paused more than 2 minutes), plus a trip log table.

**Incidents** — filter tabs (All / Open / Reviewed / Closed) with counts, a list on the left and detail panel on the right showing the driver, type, description, photo, linked trip, and current status, with an admin notes field and buttons to mark reviewed or closed.

**Schedules** — pick a driver on the left, see their week on the right with prev/next navigation, each day showing the scheduled shift (or nothing). Clicking a day opens a modal to add, edit, or delete that shift.

---

## Driver App — what each screen should do

Give this one a dark, GitHub-style look (near-black background, around `#0d1117`).

**Login** — same pattern as admin: email/password, store the JWT, go to Home.

**Home** — driver's name up top with an Online/Offline toggle (glowing green dot when online). If there's an active trip, show a banner to jump back into it. When a new trip gets assigned, show a banner for about 8 seconds and fire a push notification (ask for notification permission on first load). Below that, a 2×2 stats grid (trips completed, miles driven, hours active, earnings today), a rate card showing $15/hr and an estimated weekly total, and a 2×3 quick-action grid: My Trips, Dispatch, Schedule, Fuel Log, Inspection, Report.

**My Trips** — today's trips as cards (passenger name, pickup → dropoff, scheduled time, status badge), tapping one opens Active Trip.

**Active Trip** — this is the heart of the driver experience, and it should walk through these steps in order:
1. **En route** — an "Arrived at Pickup" button
2. **Arrived** — take a photo of the starting odometer
3. **Confirm passenger** — a "Passenger Confirmed — Start Trip" button
4. **Driving** — GPS pings fire every 5 seconds; if there are waypoints, show "Stop X of Y" with a way to open it in Maps and mark it arrived before moving to the next; once all stops are done, "Arrived at Drop-off"
5. **Odometer end** — photo of the ending odometer
6. **Rate the passenger** — 1–5 stars with an optional note, or skip
7. **Complete** — a summary of miles and time, then back to My Trips

Along the way, show the passenger's info (initials avatar, name, Medicaid ID, a call button) and the route (pickup in green with a Navigate button, stops in orange, dropoff in red with a Navigate button).

**Dispatch (Messages)** — a single ongoing thread with admin, driver messages on the right in green, admin on the left, live over the socket.

**Schedule** — the current week with prev/next navigation, each day showing shift time, hours, and estimated pay, with weekly totals at the bottom.

**Fuel Log** — a list of past fill-ups (station, gallons, cost, date, receipt link), with a form to log a new one: gallons, cost per gallon (auto-calculating the total), station name, odometer, and a receipt photo.

**Inspection** — the 12-item checklist with pass/fail toggles, a progress bar, an overall pass/fail indicator, optional photo and notes, and a submit button that's disabled if today's inspection is already done (show a "complete" summary instead).

**Report Incident** — a 2×3 grid to pick the type (Accident, Late Arrival, No Show, Passenger Complaint, Mechanical Issue, Other), a description field, an optional photo, and a submit button, with a list of past incidents below (type, date, status badge — orange for open, blue for reviewed, green for closed).

**Profile** — tap-to-upload profile photo, name/email/phone, star rating with total count, recent passenger feedback notes, vehicle info, and the $15/hr rate.

---

## Passenger App — what each screen should do

**Book a Ride** — a Medicaid ID field with a "Look Up" button that auto-fills the name if found (otherwise it stays editable for a new passenger), phone, pickup address, dropoff address, a date/time picker for the scheduled pickup, a notes field for special needs, and a "Book Ride" button.

**Booking Confirmed** — a scale-in confirmation animation, a green checkmark, "Ride Booked!", the trip ID, and a link to track the driver.

**Track Driver** — driver name, vehicle info, and a call button up top. The trip status drives the headline message (e.g., "Your driver is being assigned," "Your driver is on the way!," "Your driver has arrived!," "You're on your way!," "You've arrived. Thank you!"). A live map shows the driver's position, moving in real time over the socket, plus the pickup and dropoff addresses. Poll the trip status every 15 seconds as a fallback.

**Live News/Sports tab** — a small nice-to-have: a tab switcher between live scores and sports news, pulling from ESPN's public scoreboard and news APIs (no key required), refreshing every 60 seconds with a loading skeleton while it fetches.

---

## Environment variables

**Backend**
```
PORT=3001
JWT_SECRET=your-secret-key
NODE_ENV=development
ADMIN_APP_URL=http://localhost:3000
DRIVER_APP_URL=http://localhost:3002
PASSENGER_APP_URL=http://localhost:3003
```

**Admin app**
```
REACT_APP_SERVER_URL=http://localhost:3001
PORT=3000
```

**Driver / Passenger apps**
```
REACT_APP_SERVER_URL=http://localhost:3001   (use your machine's IP for device testing)
```

---

## Business rules to bake in

1. Every passenger record needs a Medicaid ID — this is Colorado NEMT compliance, not optional.
2. Driver payroll runs at **$15.00/hour**.
3. Fuel reimbursement is the actual logged cost, not an estimate.
4. A trip can't be marked complete without both the start and end odometer photos.
5. Trips can have zero or more waypoints; the driver works through them in order.
6. Auto-assign uses Haversine distance to find the closest available driver, falling back to the first available driver if there's no GPS data yet.
7. GPS pings come in every 5 seconds during an active trip and get appended to that trip's `gps_route`.
8. A "stop" is detected where consecutive GPS points move less than 0.001 degrees over more than 2 minutes.
9. Passengers get rated 1–5 by the driver after dropoff, and that feeds into the driver's average rating.
10. Only one inspection per driver per day — a 12-item checklist.
11. Payroll prefers scheduled shift hours, and falls back to actual trip durations if no shift was scheduled.
12. Trip status always flows in this order: `scheduled → assigned → driver_en_route_to_pickup → arrived_at_pickup → in_progress → completed` (with `cancelled` and `no_show` as exits along the way).

---

## File uploads

All of these are `multipart/form-data`:

| Endpoint | Field name | Saved to |
|---|---|---|
| `POST /api/drivers/:id/photo` | `photo` | `uploads/profiles/` |
| `PUT /api/trips/:id/odometer-start` | `photo` | `uploads/odometers/` |
| `PUT /api/trips/:id/odometer-end` | `photo` | `uploads/odometers/` |
| `POST /api/fuel` | `receipt` | `uploads/receipts/` |
| `POST /api/inspections` | `photo` | `uploads/inspections/` |
| `POST /api/incidents` | `photo` | `uploads/incidents/` |

All of it should be served back out as static files under `/uploads/`.

---

## How the live GPS flow actually works, end to end

1. When a trip starts, the driver app connects to Socket.io.
2. Every 5 seconds it emits `driver:location_update` with `{driver_id, trip_id, lat, lng, ts: Date.now()}`.
3. The server updates that driver's `current_lat`/`current_lng`, appends the point to the trip's `gps_route`, and broadcasts `admin:driver_moved` to both the admin room and anyone tracking that trip as a passenger.
4. The admin map and the passenger's tracking map both move the driver's dot live, no polling needed.

---

## Payroll export

When admin clicks "Export Payroll," generate a clean printable HTML page: driver name and pay period, an earnings table (trips, hours × $15/hr, fuel reimbursement, total), a shifts table if any were scheduled, the grand total called out clearly, a print/save-as-PDF button, and a small "RedArt LLC NEMT Platform" footer.

---

That's the full build. Let me know if any part needs more detail before you start.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://ride-red-road.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1c3c174b-6cbe-4b49-974e-a1f94a0d4813).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `redart` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
