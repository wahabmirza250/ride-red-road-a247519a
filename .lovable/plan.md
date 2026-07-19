This is a large scope — 5 major sections spanning schema, driver app UI, media capture, and multi-passenger booking. I'll plan the work in dependency order, then implement section-by-section, testing each before moving on.

## Scope confirmation

Before I start, two quick clarifications will save rework:

1. **Clock in/out vs online/offline** — you asked me to clarify. My proposal: **tie them together** (going Online = clock in, Offline = clock out). Simpler for drivers, one source of truth for paid hours. A separate clock adds a second toggle they'll forget. OK to proceed on that basis?

2. **Dual-camera recording** — browsers cannot record front + rear cameras simultaneously on iOS Safari (hard platform limitation), and even on Android Chrome recording continuously for a full trip while the app is backgrounded is unreliable. Realistic options:
   - **(a)** Record from the currently-selected camera only, driver can switch; upload chunks every ~30s. Works on all mobile browsers.
   - **(b)** Skip continuous recording, instead prompt for a short "cabin video clip" at pickup + dropoff (5-10s each). Reliable, still gives incident evidence.
   - **(c)** Defer this to the native Capacitor app where dual-camera plugins exist; stub the UI now.
   
   Which do you want? I'd recommend (b) for reliability today, with (c) as the eventual real solution.

## Section 1 — Earnings & time tracking

**Schema**
- `drivers`: add `pay_type` ('per_hour' | 'commission'), `hourly_rate numeric`
- `driver_shifts`: `id, driver_id, clock_in_at, clock_out_at, start_odometer, end_odometer, miles_driven, hours_worked (generated), earnings (generated from hourly_rate)`
- `gas_receipts`: `id, driver_id, shift_id?, amount, gallons?, photo_path, submitted_at, notes`
- Storage bucket `gas-receipts` (private, driver read own + admin read all)

**Server fns** (`src/lib/shifts.functions.ts`, `src/lib/gasReceipts.functions.ts`)
- `clockIn`, `clockOut`, `getCurrentShift`, `getShiftHistory`, `uploadGasReceipt`, `listGasReceipts`

**UI**
- Driver profile: hourly rate visible (read-only for driver, editable for admin on `_authenticated/drivers`)
- Driver dashboard cards: Today's hours, Today's miles, Live speedometer (from `watchPosition` speed), Earnings today, Clock in/out button
- Gas receipts page (`/driver/expenses`) with photo upload
- Admin drivers table: pay type + hourly rate columns editable; gas receipts tab per driver

## Section 2 — ETA fix + dashboard

- Fix `? min` on incoming ride card: compute `haversine(driver.current_lat/lng, request.pickup)` / 40 km/h, display as `~N min`. Add to the ride offer payload the driver already reads.
- Redesign `/driver` home to use stat cards from Section 1 above the offers list — a real dashboard grid, not a bare status pill.

## Section 3 — Trip documentation

**Schema**
- `ride_requests` + `trips`: `ride_purpose text` (enum-ish: doctor, dialysis, therapy, pharmacy, other)
- `trips`: `pickup_odometer_photo_path`, `dropoff_odometer_photo_path`, `signature_captured_at timestamptz`, `signature_path` (if not already)
- `trip_media`: `id, trip_id, kind (cabin_video_pickup|cabin_video_dropoff|other), storage_path, captured_at`
- Storage bucket `trip-media` (private)

**UI**
- Passenger booking flow: add "Purpose of ride" required select on pickup or vehicle step
- Driver active-trip flow: odometer photo required at "Arrived / Start" and at "Complete", short cabin video clip prompt at pickup + dropoff (option b above unless you pick different)
- Signature timestamp: ensure `signature_captured_at = now()` is written server-side when signature uploaded
- **Proof Report**: `/_authenticated/trips/$tripId/proof` — a printable page showing odometer photos, signature + timestamp, GPS route map/coords, purpose, times. PDF export via existing `medicaidPdf.ts` pattern.

## Section 4 — Mid-ride stops

**Schema**
- `trip_stops`: `id, trip_id, sequence, address, lat, lng, arrived_at, departed_at, wait_seconds (generated), added_by (driver|passenger|dispatcher)`

**UI**
- Driver active-trip screen: "Add stop" button → address autocomplete → inserts stop before dropoff, updates nav
- Passenger tracking screen: "Request a quick stop" → notifies driver
- Trip completion sums total wait time and shows stops on the Proof Report

## Section 5 — Group rides

**Schema**
- `ride_requests`: `is_group boolean`, `group_size int`
- `ride_passengers`: `id, request_id/trip_id, name, medicaid_id, phone, pickup_address, pickup_lat/lng, dropoff_address, dropoff_lat/lng, pickup_sequence, dropoff_sequence, picked_up_at, dropped_off_at`
- `trip_stops` (from Section 4) doubles as the sequenced stop list

**Server fn**
- `sequenceGroupStops`: nearest-neighbor from pickup point through all dropoffs (simple, good enough)

**UI**
- Dispatcher `/live-ops`: "New group ride" wizard — add passengers one by one, each with pickup+dropoff, then submit
- Passenger app: "Book for a group" toggle on the pickup screen → repeatable passenger cards
- Driver active-trip screen: shows the ordered stop list with "Pick up [name]" / "Drop off [name]" checkpoints

## Testing per section

- **S1** — clock in via Playwright as driver, verify `driver_shifts` row + earnings displayed
- **S2** — spawn a ride request from DB, load `/driver` with fake GPS, assert ETA text is not `? min`
- **S3** — verify purpose select renders on `/passenger/book/pickup`, camera permission prompt fires (getUserMedia call visible in console), proof report route renders with seeded trip
- **S4** — call `addTripStop` server fn, verify it appears in driver UI ordered list
- **S5** — create a group ride via dispatcher form, verify `sequenceGroupStops` returns nearest-first order

## Reporting

After each section I'll post a short "Built + tested" note before starting the next, per your instruction.

---

Please answer the two clarifications above and I'll start with Section 1.