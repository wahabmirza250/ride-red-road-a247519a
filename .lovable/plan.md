
# Driver-side digital NEMT Trip Report

Right now the driver app never captures the fields the state form requires (vehicle type, plate/VIN, escort, identity verified, one-way vs round-trip, per-leg times/odometer/addresses, and — for group tours — each rider's info + signature). We're going to build the digital equivalent of the paper form the driver fills at the curb.

## What changes for the driver

New flow, launched from the current trip screen with a big **"Complete NEMT trip"** button:

1. **Step 1 — Trip type & vehicle** (auto-filled after first use)
   - One way / Round trip / **Group tour** (multi-rider)
   - Vehicle type: Ground Ambulance · Wheelchair Van · Stretcher Van · Taxi · Mobility/Ambulatory
   - License plate / VIN
   - Escort name (optional)
   - Vehicle info remembered on driver profile so next trip auto-fills.

2. **Step 2 — Riders** (1 or many)
   - "Add rider" → search existing (by name / Med ID) or add new.
   - For each rider we store once: legal name, Health First Colorado ID, DOB, phone.
   - Toggle "Driver verified member's identity" per rider (Y/N).
   - For group tours, you can pin the same pickup/drop-off or override per rider.

3. **Step 3 — Leg 1 (Outbound)**
   - Date, Pickup address (already known from dispatch), Pickup time (AM/PM), Pickup odometer, Drop-off address, Drop-off time (AM/PM), Destination odometer.
   - Prefilled where possible: pickup address/time from the ride request, driver location, GPS odometer if the shift started with a reading.

4. **Step 4 — Leg 2 (Return, only if Round Trip)**
   - Same fields; date defaults to same day.

5. **Step 5 — Signatures** — one per rider
   - Signature pad + printed name.
   - Escort/facility staff can sign on behalf of the member; a checkbox records "signed by escort".

6. **Step 6 — Review & submit**
   - Preview the filled state PDF (one per rider) inline before submit.
   - Submit → goes to admin billing queue.

## What changes in the admin billing queue

- Group-tour trips show grouped by driver + date with the rider list.
- Round trips show both legs on the PDF.
- Admin still approves → "Send to portal" fires the runner **once per rider PDF**.

## Data model

Extend `medicaid_trips` to hold everything the form needs; add per-leg + per-rider structure.

New columns on `medicaid_trips` (nullable so existing rows stay valid):

- `trip_kind` enum: `one_way` | `round_trip` | `group_tour`
- `vehicle_type` enum: `ground_ambulance` | `wheelchair_van` | `stretcher_van` | `taxi` | `ambulatory`
- `vehicle_plate` text, `vehicle_vin` text
- `escort_name` text
- `identity_verified` bool
- `signed_by_escort` bool
- `group_id` uuid — groups all rider-rows of the same physical trip; null for solo trips

New table `medicaid_trip_legs`:
```
id, medicaid_trip_id (fk), leg_index (1|2),
date, pickup_time, pickup_odometer, pickup_address,
dropoff_time, dropoff_odometer, dropoff_address
```
(A one-way trip = 1 leg; round trip = 2 legs. Group tours share the same legs across all rider-rows via `group_id`.)

New columns on `drivers`:
- `default_vehicle_type`, `default_plate`, `default_vin` — saved once, reused.

Existing `riders` already stores name + Med ID + DOB — good.

RLS: drivers can insert/update their own rows; admins full access. Legs inherit via join.

## PDF generator update

`generateStateFormPdf` becomes `generateStateFormPdfs(tripGroup)`:

- Iterates the riders in the group.
- Renders one PDF per rider, using the same driver / vehicle / leg data.
- Fills all newly-captured fields (vehicle type checkbox, plate/VIN, escort, identity Y/N, both legs, per-rider signature).

Coordinates for the extra fields are calibrated once against the April 2025 template already uploaded (nothing to re-upload — that file is our source of truth).

## Files to create / modify

Create:
- `src/routes/driver.trip.new.tsx` — the 6-step wizard (uses shadcn `Tabs` + form components).
- `src/components/driver/TripWizard/` — `StepVehicle.tsx`, `StepRiders.tsx`, `StepLeg.tsx`, `StepSignatures.tsx`, `StepReview.tsx`.
- `src/lib/nemtTrip.functions.ts` — server fns: `saveDefaultVehicle`, `createTripGroup`, `saveTripLeg`, `attachRiderSignature`, `submitGroupForReview`.
- Migration: new columns on `medicaid_trips` + `drivers`, new `medicaid_trip_legs` table with grants + RLS.

Modify:
- `src/lib/medicaidPdf.ts` — support 2 legs + all extra checkboxes; export a `generateForRider(group, riderId)` helper.
- `src/routes/driver.index.tsx` — add "Complete NEMT trip" CTA linking to the wizard.
- `src/routes/_authenticated/medicaid-billing.tsx` — group by `group_id`, download-all button for group tours, "Send to portal" iterates per rider.
- `src/lib/portalSubmit.functions.ts` — accept `medicaid_trip_id` list (one call per rider) OR add `submitGroupToPortal` that fans out.

## Open questions (please confirm before I build)

1. **Group tour = one signed form per rider, right?** (Colorado still requires one Trip Report per Medicaid member even if they rode together.) If yes, we generate N PDFs from shared trip data.
2. **Escort/facility signing** — should a single escort signature cover all riders in a group tour, or does each rider still need their own signature block?
3. **Odometer** — capture once per leg (shared across group tour riders) is what the form implies. Confirm.
4. **Vehicle info** — is it fine to save vehicle type + plate/VIN on the driver's profile and let them override per trip? (Cuts data entry to zero after first use.)
5. **Default identity-verified** — should the Y checkbox default to Yes with the driver having to un-check, or default blank?
