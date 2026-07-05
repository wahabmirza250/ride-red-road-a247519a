# Medicaid Billing Rework Plan

Rebuild `/medicaid-billing` around a 6-stage review pipeline with an audit trail, encrypted state-portal credentials, and an automated submit-to-state pipeline that calls out to an external automation service (RPA/Playwright worker) and gets a webhook callback.

The existing app already has: `medicaid_trips` (with `status`, PDF path, signature path), the HFC runner scaffolding, and a `medicaid-billing.tsx` page. We keep the trip data on `medicaid_trips` and add a **`billing_records`** row per trip that owns the review/submit lifecycle. This preserves existing flow (driver submits → trip appears for review) while decoupling billing state from trip state.

## 1. Database (single migration)

### `billing_records` (new)
- `trip_id` uuid FK → `medicaid_trips.id` UNIQUE
- `trip_form_id` uuid nullable (future-proof reference to a distinct form record; today = trip_id)
- `status` text CHECK IN (`pending_review`, `pending_submit`, `submitting`, `submitted`, `approved`, `rejected`, `needs_fix`) default `pending_review`
- `reviewed_by` uuid → `auth.users.id`, `reviewed_at` timestamptz
- `fix_notes` text, `rejection_reason` text
- `submitted_at` timestamptz, `state_confirmation_number` text
- `submission_error` text
- `created_at`, `updated_at` (trigger)

GRANT SELECT/INSERT/UPDATE to `authenticated`; ALL to `service_role`. RLS: admins can do everything (`has_role(auth.uid(),'admin')`); drivers can SELECT their own via join to `medicaid_trips.driver_id = auth.uid()`.

Trigger: when a `medicaid_trips` row transitions into `pending_review`, auto-insert the matching `billing_records` row (idempotent).

### `billing_audit_log` (new)
- `billing_record_id` FK
- `action` text (`approved`, `needs_fix`, `submit_requested`, `submitting`, `submitted`, `submit_failed`, `marked_approved`, `marked_rejected`, `credentials_updated`)
- `actor_id` uuid, `actor_type` text (`admin`|`driver`|`system`)
- `notes` text
- `created_at`

Admins SELECT/INSERT; service_role ALL. Realtime enabled.

### `state_portal_credentials` (new)
- `portal_name` text, `state` text, `login_email` text
- `login_password_encrypted` bytea (encrypted with pgsodium/vault secret)
- `last_used_at` timestamptz

Admin-only RLS. Password never returned to the client raw — a security-definer RPC `get_portal_credentials_masked()` returns `login_email` and a masked password (`•••• last4`) for the UI. Only the edge function reads the plaintext via service role + `vault.decrypted_secrets`.

### Realtime
Add `billing_records` and `billing_audit_log` to `supabase_realtime` publication.

## 2. Edge Functions

Only external I/O lives here — internal reads stay in TanStack server fns.

### `submit-to-state-portal` (POST, JWT-verified, admin only)
Input: `{ billing_record_ids: string[] }`.
- Verify caller is admin (`has_role`).
- For each id: set status → `submitting`, log audit `submitting`.
- Load trip + rider + signed URLs for PDF + signature (15 min).
- POST to `AUTOMATION_SERVICE_URL/submit` with `x-api-key: AUTOMATION_SERVICE_API_KEY`, HMAC-signed body containing trip payload, PDF URL, signature URL, and `callback_url = SITE_URL/api/public/receive-submission-result`.
- On network/HTTP failure: status → `pending_submit`, save `submission_error`, log `submit_failed`.
- Return per-id result.

### `/api/public/receive-submission-result` (TanStack server route, unauthenticated + HMAC-verified)
Input: `{ billing_record_id, success, state_confirmation_number?, error_message? }`.
- Verify HMAC signature header against `AUTOMATION_SERVICE_HMAC_SECRET` (timing-safe).
- Success → status `submitted`, save confirmation number & `submitted_at`, log `submitted`.
- Failure → status `pending_submit`, save `submission_error`, log `submit_failed`.
- Idempotent on `billing_record_id`.

Secrets to add via `add_secret`: `AUTOMATION_SERVICE_URL`, `AUTOMATION_SERVICE_API_KEY`, `AUTOMATION_SERVICE_HMAC_SECRET`.

## 3. TanStack Server Functions (`src/lib/billing.functions.ts`)

All `requireSupabaseAuth` + admin check:
- `listBillingRecords({ status })` — joins trip + rider + driver profile.
- `getBillingRecord({ id })` — full detail incl. signed URLs for PDF & signature.
- `approveBillingRecord({ id })` — `pending_review` → `pending_submit`, audit `approved`.
- `requestFix({ id, notes })` — status → `needs_fix`, save notes, audit `needs_fix`, insert notification/message row to driver.
- `submitBillingRecords({ ids })` — calls the edge function above; returns results.
- `markApproved({ id })` / `markRejected({ id, reason })` — post-submission manual state response, audit accordingly.
- `listAuditLog({ id })`.
- `upsertPortalCredentials({ portal_name, state, login_email, login_password })` — encrypts via `vault.create_secret` (or pgsodium), stores reference, audit `credentials_updated`.
- `listPortalCredentialsMasked()`.

## 4. UI

### `/medicaid-billing` page
Rework tabs to: **Pending Review | Pending Submit | Submitted | Approved | Rejected | Needs Fix**. Each tab = table (passenger, driver, trip date, status badge, `submitting` shows spinner). Row click → side sheet detail.

Detail sheet:
- Passenger identity (name, Medicaid ID, DOB, last-4 SSN)
- Pickup/dropoff time+address, odometer start/end, driver, mileage
- Signature image, inline `<iframe>` PDF preview, Download PDF
- Audit trail list
- Actions vary per tab:
  - Pending Review: **Approve**, **Needs Fix** (textarea for notes)
  - Pending Submit: **Submit**; page shows **Submit All** + multi-select checkboxes; **Retry** on `pending_submit` rows with `submission_error` (shown as banner)
  - Submitted: **Mark Approved**, **Mark Rejected** (reason)
  - Rejected: read-only + reason
  - Needs Fix: read-only + notes; awaiting driver

Realtime subscription on `billing_records` invalidates the list/detail so status flips (`submitting` → `submitted`) appear live.

### Settings — State Portal Credentials card
On `/team` (Team & apps): card listing portals with masked password, Edit dialog to update (writes via `upsertPortalCredentials`), admin-only.

## 5. Files

**New**
- `supabase/migrations/<ts>_billing_pipeline.sql`
- `supabase/functions/submit-to-state-portal/index.ts`
- `src/routes/api/public/receive-submission-result.ts`
- `src/lib/billing.functions.ts`
- `src/components/billing/BillingDetailSheet.tsx`
- `src/components/billing/PortalCredentialsCard.tsx`

**Rewrite**
- `src/routes/_authenticated/medicaid-billing.tsx` (6 tabs, multi-select, realtime)

**Edit**
- `src/routes/_authenticated/team.tsx` — mount `PortalCredentialsCard`

## Questions before I build

1. **Automation service** — do you already have an external URL for the RPA/automation worker (Playwright bot that logs into the state portal)? If not, I'll wire the edge function + webhook but leave the URL/API-key/HMAC-secret to be added later via secrets, and I'll add a "Runner not configured" banner instead of failing silently.
2. **State portal credentials encryption** — OK to use Supabase Vault (`vault.create_secret`) with the plaintext only readable by the edge function via service role? UI will only ever show a masked value + last-used timestamp.
3. **"Needs Fix" driver notification** — in-app toast + entry in existing driver messages/inbox, matching the realtime pattern already used on live-ops?
