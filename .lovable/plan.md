## Goal

Turn the app from single-tenant into a multi-tenant platform with hard per-company data isolation, company-slug URLs, and a platform-owner super-admin panel at `/owner`.

This is too large for one pass. It ships in 5 phases; each phase is verified against real data before the next starts.

## Assumptions (correct me if wrong)

- Existing real data becomes one company: **Walla Investment LLC** (slug `walla`), and every existing row is backfilled to it.
- Your account is the only `platform_owner`. Please confirm which email should get it.
- Company scoping is derived from the **signed-in user's company**, not from the URL slug. The slug drives branding + signup/booking context; it can never widen access.
- Old URLs (`/driver`, `/dispatch`, `/dashboard`, `/passenger`) keep working and redirect to the signed-in user's company slug, so bookmarks don't break.

## Phase 1 — Companies foundation (database)

- `companies` table: id, name, logo_url, url_slug (unique, URL-safe), status (`active` | `suspended`), timestamps.
- Add `company_id` to: `drivers`, `passengers`, `riders`, `trips`, `ride_requests`, `medicaid_trips`, `billing_rate_settings`, `state_portal_credentials`, `billing_records`, `routes`, `driver_shifts`, `gas_receipts`, `user_roles`.
- Backfill every existing row to the Walla company, then make `company_id` NOT NULL where safe and add indexes.
- Add `platform_owner` to the `app_role` enum.
- Helper security-definer functions: `current_user_company_id()`, `is_platform_owner()`, `company_is_active(uuid)`.
- Rewrite RLS on every scoped table so policies require `company_id = current_user_company_id()` (platform owner bypass where needed). This is the real isolation layer — even a buggy client query cannot cross tenants.
- Triggers to auto-stamp `company_id` on insert from the creating user's company.

Verification: query each table as Company A's admin JWT and confirm zero Company B rows are visible.

## Phase 2 — App-side scoping

- A single server-side `getCallerCompany()` helper used by every `*.functions.ts` handler.
- Add explicit `.eq("company_id", …)` filters to all list/read/write queries as defense in depth (RLS is the backstop).
- Matching logic: `dispatchRideRequest`, offer fan-out, auto-assign and group-ride functions filter candidate drivers by `company_id`.
- Login blocked with a clear message when the user's company is suspended.

## Phase 3 — URL structure

- New route layout `/{company-slug}/…` wrapping driver / passenger / dispatch / dashboard trees.
- Slug resolved once into company context (branding, logo, signup target) and validated against the signed-in user's company.
- Legacy paths redirect to the slug-prefixed equivalent.

## Phase 4 — Owner panel (`/owner`)

- `platform_owner`-only route, hard-gated server-side (not just client redirect).
- Create company (name, logo upload, auto slug, editable), list companies with driver/passenger/dispatch/trip counts and last activity.
- Suspend / reactivate.
- Create a company's first admin (email + password) via the Auth admin API, tied to that company.
- Per-company oversight: HCPF credentials configured yes/no + last verified (never the password), billing rates configured yes/no, and a health-check trigger against that company's portal account.
- Platform totals: companies, drivers, passengers, trips, real claims submitted.

## Phase 5 — End-to-end testing (reported individually)

1. Create two test companies via the owner panel.
2. Create a driver + passenger under each.
3. Book a ride as Company A's passenger — assert only Company A drivers are candidates.
4. Log in as Company A admin — assert zero Company B rows on drivers, passengers, trips, billing, claims history.
5. Suspend Company B — assert its users are blocked at login.
6. Re-run a real billing-rate check on the migrated Walla/A-MED data to confirm nothing broke.

## Technical notes

- Isolation is enforced primarily in Postgres RLS, so it holds even for queries I miss in app code; app-level filters are secondary.
- The migration is large and runs in one transaction per phase-1 step; existing rows are backfilled before NOT NULL is applied to avoid downtime errors.
- `platform_owner` is granted only by direct SQL, never through app UI, and the existing `guard_user_roles_write` trigger is extended to block it.

## Risks

- Tightening RLS on ~15 tables can break existing screens; Phase 2 exists specifically to catch that, and I'll re-test the driver, dispatch, admin and billing flows before moving on.
- Route restructuring touches every link in the app; legacy redirects mitigate bookmark breakage.