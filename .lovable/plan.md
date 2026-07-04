## Goals

Fix the assign-to-driver flow, surface real driver names everywhere, allow deletion, ship an Uber-style pill map, add profile pictures, and fill in the driver app with more useful surfaces.

## 1. Assigned trip not showing in driver app

Root cause: admin "Auto‑assign" writes to `trips` only, but `driver.index.tsx` only reads from `ride_requests`. So a trip assigned from admin is invisible to the driver.

Fix in `src/routes/driver.index.tsx`:
- Add a second query for `trips` where `driver_id = my driver.id` and `status IN ('assigned','driver_en_route_to_pickup','arrived_at_pickup','in_progress')`.
- Treat this as the active trip when no `ride_requests`-based active trip exists. Reuse the existing pickup/dropoff/passenger/nav/complete UI, plus an explicit "Accept" for admin-assigned trips that flips status to `driver_en_route_to_pickup`.
- Add a realtime subscription filter on `trips` for `driver_id=eq.<id>`.

## 2. Real driver names (with avatar) everywhere

- In `src/routes/_authenticated/trips.tsx`, replace `driverName()`'s `Driver <id-slice>` with a lookup that joins `profiles` (first_name, last_name, avatar_url). Same in the driver `<Select>` options in `NewTripDialog`.
- Update `useDrivers` result rendering in `drivers.tsx` to show avatar chip.

## 3. Delete driver

- Add server fn `deleteDriver({ driverId })` in `src/lib/admin.functions.ts` (admin-role guarded): delete rows in `drivers`, `user_roles`, then `supabaseAdmin.auth.admin.deleteUser(user_id)`.
- Add a red "Delete driver" button in `EditDriverDialog` (drivers.tsx) with confirm.

## 4. Driver profile picture

- Create storage bucket `avatars` (public read) via migration.
- Add `avatar_url` column to `profiles` if missing.
- In `drivers.tsx` EditDriverDialog and a new `/driver/profile` page: upload to `avatars/{user_id}.jpg`, save `avatar_url`.
- Show avatar in driver top bar (`driver.tsx`), trips list, and drivers grid.

## 5. Uber-style pill map (admin Live Ops)

Enhance `src/routes/_authenticated/live-ops.tsx` map to render driver pins as rounded black pills with the driver's first name + status dot (like the reference image). Uses existing Google Maps loader + `DriverFleetMap` in `MapView.client.tsx`. Custom `OverlayView`-style DOM pills with:
- Black rounded-full background, white text, small avatar/star icon on the left.
- Green dot for `available`, amber for `on_trip`, gray for `offline`.
- Hover raises a shadow; click opens the driver detail drawer.

Passenger `/passenger` also gets a small map preview using the same component.

## 6. Fill in the driver app

Add to `driver.tsx` bottom nav / home:
- **Today** stat strip on home: trips completed today, earnings today, online hours, rating. Read from `trips` + `drivers`.
- **Profile** page (`/driver/profile`): avatar upload, name, phone, vehicle info (read-only), sign out.
- **History** page (`/driver/history`): last 30 days of trips with fare + rating.
- Home empty state: quick tiles for "Go online", "View earnings", "Messages", "Profile".

## Technical notes

- New migration: `avatars` bucket + `profiles.avatar_url` (nullable text). Public read policy, authenticated upload to own path.
- `deleteDriver` server fn requires `has_role(auth.uid(),'admin')`; uses `supabaseAdmin` inside handler.
- Pill markers render via `google.maps.OverlayView` subclass loaded inside `MapView.client.tsx` (client-only).
- No schema change for trip assignment; only client-side query change fixes the invisibility bug.

## Files touched

- `src/routes/driver.index.tsx` — read assigned trips
- `src/routes/driver.tsx` — avatar in header, add Profile tab
- `src/routes/driver.profile.tsx` — new
- `src/routes/driver.history.tsx` — new
- `src/routes/_authenticated/trips.tsx` — real driver names
- `src/routes/_authenticated/drivers.tsx` — avatar upload, delete button
- `src/routes/_authenticated/live-ops.tsx` — pill markers
- `src/components/nemt/MapView.client.tsx` — pill overlay
- `src/lib/admin.functions.ts` — `deleteDriver`, `updateDriverAvatar`
- `supabase/migrations/<new>.sql` — avatars bucket + `profiles.avatar_url`
