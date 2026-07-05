## Driver trip flow — stage-based rework

Replace the current 5-step wizard on the driver app with a live, stage-driven flow that mirrors the real ride. The portal (admin dashboard) sees each status change in real time via Supabase Realtime.

### New driver stages

```
Assigned  →  Start Pickup  →  En route to pickup  →  Arrived  →
Pickup form (in car)  →  Start Ride  →  Driving  →  Arrived at dropoff  →
Dropoff form  →  Signature  →  Submit
```

At every transition the driver taps ONE big button. The screen only shows fields relevant to the current stage — no wizard tabs.

### Per-stage behavior

1. **Assigned** — Driver sees trip card with rider name, pickup + dropoff addresses, scheduled time. Buttons: `Start Pickup`, `Show Pickup on Google Maps` (deep link `https://www.google.com/maps/dir/?api=1&destination=...`).
2. **En route to pickup** — Tapping Start Pickup writes `status='en_route_pickup'`, `pickup_started_at=now()`. Location ping keeps updating driver row. Portal toast: "Driver started pickup".
3. **Arrived** — `I've Arrived` button → `status='at_pickup'`, `arrived_pickup_at=now()`. Portal toast.
4. **Pickup form (passenger in car, before driving)** — Fields captured now:
   - Rider printed name (prefilled from assigned rider, editable)
   - Medicaid ID (prefilled, editable) **OR** DOB + last 4 SSN if no Medicaid ID
   - Starting odometer (numeric)
   - Optional odometer photo (existing bucket)
   - Rider signature (existing SignaturePad)
   - Auto-captured: pickup time, pickup GPS lat/lng, pickup address
   Button: `Start Ride` (disabled until required fields valid).
5. **Driving** — `status='in_progress'`, `ride_started_at=now()`. Screen shows big `Show Dropoff on Google Maps` + live elapsed time + `Arrived at Dropoff` button.
6. **Arrived at dropoff** — `status='at_dropoff'`, `arrived_dropoff_at=now()`.
7. **Dropoff form**
   - Ending odometer (must be ≥ starting)
   - Optional ending odometer photo
   - Auto-captured: dropoff time, GPS, dropoff address, computed miles
   Button: `Complete Trip`.
8. **Submit** — Generates state PDF per rider (existing pipeline), uploads to `state-pdfs`, sets `status='pending_review'`, shows confirmation screen with View PDF / Done.

### Rider identity rule (SSN fallback)

- Assigned rider record is pre-selected.
- If Medicaid ID is present → use it, hide SSN field.
- If Medicaid ID is blank → show `DOB` + `Last 4 of SSN` (both required). Last 4 SSN is stored in a new nullable encrypted column `last_4_ssn` on `riders`, visible only to admins with the `billing` role in the review dialog. Never rendered on the PDF unless the state form calls for it — for now it goes into the "Member ID" field of the PDF prefixed with `SSN-####` if that's what admin uses to bill.

### Portal (admin) real-time updates

- Enable Realtime on `medicaid_trips` (already used? if not, add `ALTER PUBLICATION supabase_realtime ADD TABLE public.medicaid_trips`).
- Admin dashboard `/live-ops` and `/trips` subscribe to `postgres_changes` on `medicaid_trips` and show a Sonner toast on each status change: "Driver X started pickup for Rider Y", "arrived", "in progress", "completed".
- No push, no SMS.

### Google Maps handoff

- On mobile: `google.navigation:q=<lat>,<lng>` if UA is Android, else `maps://?daddr=` on iOS, else universal `https://www.google.com/maps/dir/?api=1&destination=...`. Single helper `openNavigation({lat, lng, address})` in `src/lib/mapsDeepLink.ts`.

### Data model changes

Migration adds to `medicaid_trips`:
- `pickup_started_at timestamptz`
- `arrived_pickup_at timestamptz`
- `ride_started_at timestamptz`
- `arrived_dropoff_at timestamptz`
- `pickup_lat/lng double precision`, `dropoff_lat/lng double precision`
- status enum values extended: `en_route_pickup`, `at_pickup`, `in_progress`, `at_dropoff` (currently only `pending_review`/`approved`/etc.)

Migration adds to `riders`:
- `last_4_ssn text` (nullable, length-checked 4 digits)

Also ensure Realtime publication includes `medicaid_trips`.

### Files to touch

- **New**: `src/lib/mapsDeepLink.ts`, `src/components/driver/StageCard.tsx`.
- **Rewrite**: `src/routes/driver.trip.new.tsx` — stage machine instead of Tabs wizard. Reuses `SignaturePad`, PDF generation, `attachStatePdf`, confirmation screen.
- **Edit**: `src/routes/driver.index.tsx` — assigned trip card gets `Start Pickup` + Google Maps button.
- **Edit**: `src/lib/nemtTrip.functions.ts` — add `updateTripStage({trip_id, stage, timestamp, lat, lng})` server fn.
- **Edit**: `src/routes/_authenticated/live-ops.tsx` + `trips.tsx` — Realtime subscription + toast.
- **Edit**: `src/routes/_authenticated/medicaid-billing.tsx` — reviewer sees `last_4_ssn` only if role=admin and Medicaid ID missing.
- **Migration**: schema + realtime changes above.

### What stays the same

- PDF generation pipeline, storage buckets, HFC portal runner, billing review UI shell, rider search + create-new-rider logic.

### Confirm before I build

1. Extended status values (`en_route_pickup`, `at_pickup`, `at_dropoff`) added as free text on `medicaid_trips.status` (already text column) — OK to just widen without enum change?
2. `last_4_ssn` stored as plain text with strict RLS (admins only) vs pgcrypto-encrypted. Plain-text with tight RLS is simpler; encryption needs a key managed by you. Pick one.
