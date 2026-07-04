
# NEMT Billing Automation Plan

Goal: turn every completed trip into a signed Colorado NEMT Trip Report PDF, then submit it to the Health First Colorado provider portal automatically — with a mandatory human review step — even though the state offers no API.

## 1. Data model (Lovable Cloud)

Add tables so we only ask for member info once:

- `member_billing_profiles` (one row per passenger)
  - `passenger_id` (FK), `member_health_first_id`, `full_legal_name`, `dob`, `escort_name_default`, `default_pickup_address`, `verified_at`
- `vehicles`
  - `driver_id` (FK), `license_plate`, `vin`, `vehicle_type` (ambulance/wheelchair/stretcher/taxi/ambulatory)
- `billing_submissions` (one per trip billed)
  - `trip_id`, `status` (draft → signed → in_review → approved → submitting → submitted → failed), `pdf_path` (storage), `signature_path`, `portal_confirmation_number`, `portal_screenshot_path`, `submitted_at`, `submitted_by`, `error_log`
- `portal_credentials` (single admin-managed row, encrypted)
  - stored as Cloud secrets `HFC_PORTAL_USERNAME` / `HFC_PORTAL_PASSWORD`, not in DB

Storage buckets: `nemt-pdfs` (private), `signatures` (already exists), `portal-evidence` (private) for confirmation screenshots.

## 2. Auto-fill the state PDF

- Keep the official April 2025 PDF as a template in `nemt-pdfs/templates/trip_report.pdf`.
- Server function `generateTripReport(tripId)`:
  - Pulls trip (pickup/drop addresses, times, odometer readings, driver, vehicle, passenger).
  - Pulls `member_billing_profiles` for the passenger (Med ID, legal name, DOB). If missing, returns `needs_member_info: true` so the UI prompts the driver once.
  - Uses `pdf-lib` to fill AcroForm fields; if the state PDF has no form fields, overlays text at fixed coordinates (measured once from the template).
  - Writes to `nemt-pdfs/{trip_id}/unsigned.pdf`.

## 3. Passenger signature capture

- New `driver.trip.$id.sign.tsx` route: canvas signature pad (react-signature-canvas).
- Uploads PNG to `signatures/{trip_id}.png`, then server fn `attachSignature(tripId)` embeds it into the PDF at the Member's Signature box → writes `nemt-pdfs/{trip_id}/signed.pdf`, sets submission status = `signed`.

## 4. Admin review queue

- New `_authenticated/billing.tsx` (admin only via `has_role`):
  - Lists submissions with status `signed`, shows PDF preview (`<iframe>` via signed URL).
  - Buttons: **Approve & Submit**, **Reject** (with reason, sends back to driver).
  - Approve transitions to `in_review → approved` and enqueues submission.

## 5. Portal submission (no API → browser automation)

Because Health First Colorado has no billing API, we drive their web portal headlessly. This CANNOT run inside the Cloudflare Worker runtime (no Chromium, no long-lived processes). We host it separately and call it from a server function:

- **Runner**: a small Node service using **Playwright** (Chromium), deployed on a worker-friendly host (Fly.io, Railway, Render, or a small VPS). Repo lives in `/automation/hfc-runner/` for reference; deployed independently.
- Endpoint: `POST /submit` with HMAC-signed payload `{ submission_id, pdf_url (signed), member_id, trip fields }`.
- Runner script:
  1. Launch Chromium, go to Health First provider portal login.
  2. Read `HFC_PORTAL_USERNAME` / `HFC_PORTAL_PASSWORD` from its own env (never sent from client).
  3. Handle MFA: if the portal requires OTP, the runner pauses and posts back to a `/api/public/hfc-mfa-request` webhook; admin enters the code in the UI; runner polls a short-lived token to continue. (Confirm MFA type before build.)
  4. Navigate to the NEMT claim entry page, fill fields from payload, upload the signed PDF.
  5. Screenshot every step into `portal-evidence/{submission_id}/step-N.png`.
  6. Capture confirmation number, POST result to `/api/public/hfc-callback` (HMAC verified).
- Lovable side:
  - Server route `src/routes/api/public/hfc-submit.ts` triggers the runner (signed request).
  - Server route `src/routes/api/public/hfc-callback.ts` updates submission row, stores screenshots.
  - Admin UI live-updates via Supabase Realtime on `billing_submissions`.

## 6. Human-in-the-loop guardrails

- Nothing is submitted without an admin clicking **Approve & Submit**.
- After the runner logs in and reaches the final "Submit claim" button, it can optionally **stop and screenshot** for a second confirmation click in-app before the final submit (configurable per-tenant; default ON for the first 30 days).
- Full audit trail: who approved, when, screenshots, confirmation number, raw HTML of the confirmation page.

## 7. Security & compliance notes (PHI)

- Med ID, DOB, SSN-last-4, and signed PDFs are PHI — restrict via RLS to the owning driver and admins only; deny `anon`.
- Storage buckets private; access only through signed URLs generated server-side.
- Portal credentials live only in the runner's env (and a Lovable Cloud secret mirror for rotation UI). Never returned to the browser.
- All runner traffic signed with `HFC_RUNNER_HMAC_SECRET`.
- Add a Business Associate Agreement reminder in the admin panel; note that we are not a HIPAA-audited platform out of the box — this workflow must be reviewed by the customer's compliance officer.

## 8. What we need from you before build

1. Confirm the exact portal URL you bill through (Gainwell/Health First Colorado provider web portal, or the DXC/Kepro NEMT portal?).
2. Does that portal use MFA? SMS, email, TOTP?
3. Do you have a test/sandbox provider account we can point the runner at first?
4. Where should we host the Playwright runner? (Fly.io is cheapest & fastest to stand up — ~$5/mo.)
5. Do you want the "second confirm click" guardrail permanently on, or only for the first N submissions?

## Technical summary

```text
Trip complete
  → generateTripReport() fills PDF (pdf-lib)
  → driver captures signature → attachSignature() embeds into PDF
  → status=signed → appears in admin /billing queue
  → admin Approve & Submit
  → POST /api/public/hfc-submit → signed call to Playwright runner
  → runner logs in, fills claim, uploads PDF, screenshots each step
  → (optional) pause for admin final-confirm click
  → runner submits, captures confirmation #
  → callback → billing_submissions.status=submitted, evidence stored
```

## Files to create (build phase)

- Migration: `member_billing_profiles`, `vehicles`, `billing_submissions` + RLS + grants
- `src/lib/billing.functions.ts` — `generateTripReport`, `attachSignature`, `approveSubmission`, `requestPortalSubmit`
- `src/lib/pdfFill.server.ts` — pdf-lib overlay helpers
- `src/routes/driver.trip.$id.sign.tsx` — signature pad
- `src/routes/_authenticated/billing.tsx` — admin review queue
- `src/routes/_authenticated/billing.$id.tsx` — single submission detail + Approve
- `src/routes/api/public/hfc-submit.ts`, `hfc-callback.ts`, `hfc-mfa-request.ts` (HMAC-verified)
- `automation/hfc-runner/` — standalone Playwright service (Dockerfile + README for deploy)
- Secrets: `HFC_RUNNER_URL`, `HFC_RUNNER_HMAC_SECRET`, and on the runner: `HFC_PORTAL_USERNAME`, `HFC_PORTAL_PASSWORD`
