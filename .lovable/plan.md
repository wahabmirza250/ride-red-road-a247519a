## What you're asking for

1. **Driver app "Navigate" button** throws `ERR_BLOCKED_BY_RESPONSE`.
2. **Dispatch address inputs** should autocomplete like Google Maps (type → suggestions).
3. **Live Ops / admin main map**: below the map, list all drivers; clicking one **zooms** the map to that driver's exact location.
4. Map should default to a **city-level view**, not a random driver's coordinates.

## Plan

### 1. Fix Navigate button (`src/routes/driver.index.tsx`)

Root cause: the button is an `<a target="_blank">` opening `google.com/maps/dir/...` from inside the Lovable preview iframe. The preview sandbox strips the popup and the browser reports `ERR_BLOCKED_BY_RESPONSE` (Google refuses to render in an iframe via `X-Frame-Options: DENY`).

Fix:
- Replace the anchor with a real `<Button onClick>` that calls `window.open(navUrl, "_blank", "noopener,noreferrer")`. Popups from a user gesture escape the sandbox correctly.
- On mobile, prefer a native intent: try `geo:lat,lng?q=lat,lng(Label)` first (iOS/Android), fall back to the Google Maps web URL.
- Add a small "Copy address" secondary button as a guaranteed fallback so the driver is never stuck.

### 2. Address autocomplete for dispatch (`src/routes/_authenticated/trips.tsx`)

- Enable the Google Maps Platform connector (Places API New).
- Create `src/components/AddressAutocomplete.tsx`: a controlled input that debounces the user's keystrokes, calls `AutocompleteSuggestion.fetchAutocompleteSuggestions()` via the browser Maps JS lib (using `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`), and shows a dropdown of matches. On select it fills the address and returns `{ address, lat, lng, placeId }` to the parent.
- A tiny `src/lib/googleMapsLoader.ts` loads the Maps JS API once with `loading=async&libraries=places&callback=...`.
- Replace the two plain `<Input>` fields in the "New trip" form (lines 437–442) with `<AddressAutocomplete>`. Store the resolved lat/lng alongside the address so trips get real coordinates (fixes downstream map/geocoding calls too).
- Same component can later be reused in the passenger apply form.

### 3. Driver list + click-to-zoom on Live Ops map (`src/routes/_authenticated/live-ops.tsx` + `src/components/nemt/MapView.client.tsx`)

- Extend `DriverFleetMap` to accept an optional `focus?: { lat; lng; zoom? }` prop. Inside, a small child component uses `useMap()` from `react-leaflet` and calls `map.flyTo([lat, lng], zoom ?? 15)` whenever `focus` changes.
- In `live-ops.tsx`:
  - Add a `focus` state, default `null`.
  - Below the map, render a "Drivers" list showing avatar (already wired), name, status dot, last-known coords / "no GPS". Clicking a row that has coordinates sets `focus` to that driver's lat/lng; rows without GPS are disabled.
  - Selected row gets a highlighted ring and the pill on the map animates via `flyTo`.
- Also expose the same list on the "Active requests" side for symmetry — out of scope for this pass; only the drivers list is added.

### 4. Default map center on a city, not the first driver

- Add a `DEFAULT_CENTER` constant (Denver `[39.7392, -104.9903]` — already used as fallback) and a `DEFAULT_ZOOM = 11`.
- Compute center as: `focus ?? (markers.length ? fitBounds(markers) : DEFAULT_CENTER)`. When no `focus` and multiple markers exist, use `map.fitBounds()` inside the same `useMap()` helper on first render; when zero markers, stay on the city.
- Update `useClientMap.tsx` type to forward the new `focus` prop.

### Technical notes

- All Places calls go through the browser key that ships with the Google Maps connector; no server function needed for autocomplete.
- Geocoding the selected place uses the `location` field returned by Places API New (`X-Goog-FieldMask: places.location,places.formattedAddress,places.displayName`) — one gateway `POST /places/v1/places:searchText` per selection to resolve lat/lng, or read them directly from the suggestion detail call.
- No DB migration needed. `trips` already has `pickup_lat/lng` and `dropoff_lat/lng`.
- No changes to auth, RLS, or server functions.

### Files touched

- `src/routes/driver.index.tsx` — swap anchor for button + native intent + copy fallback
- `src/routes/_authenticated/trips.tsx` — use `AddressAutocomplete` in New Trip form, persist lat/lng
- `src/routes/_authenticated/live-ops.tsx` — driver list + focus state + default city center
- `src/components/nemt/MapView.client.tsx` — `focus` prop, `flyTo` helper, `fitBounds` on first load
- `src/components/nemt/useClientMap.tsx` — forward `focus` prop
- `src/components/AddressAutocomplete.tsx` — **new**
- `src/lib/googleMapsLoader.ts` — **new**

### Connector

- Requires enabling the **Google Maps Platform** connector (managed key is fine on `*.lovable.app`). I'll trigger the connect prompt as the first build step.
