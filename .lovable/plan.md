## Goal

After the driver finishes the NEMT trip wizard, the system should:
1. Automatically generate the official Colorado NEMT Trip Log PDF (the one you just uploaded), pre-filled with every field the driver entered.
2. Save one PDF per rider to secure storage so the driver, the reviewer, and the state portal all see the same file.
3. Show the driver the finished PDF so they know it worked.
4. Let the admin review it, then "Bill to state" auto-uploads that saved PDF via the existing portal runner — no re-generation, no manual download.

## What changes

### 1. Update the PDF template to your uploaded April 2025 accessible form
Replace `src/assets/nemt_trip_report_template.pdf.asset.json` with the newly uploaded `Non-Emergent_Medical_Transportation_Trip_Log_042025_Accessible-3.pdf`. Recalibrate the field coordinates in `src/lib/medicaidPdf.ts` against the new template so every checkbox and line lands exactly on the form (member name, Medicaid ID, DOB, driver/vehicle, one-way vs round-trip, both trip legs with date/time/odometer/address, escort, signature image and printed name).

### 2. Generate + upload the PDF at trip submit (driver app)
In `src/routes/driver.trip.new.tsx` `handleSubmit`, after `createNemtTripGroup` and the signature upload, for each rider:
- Call `generateStateFormPdf(...)` with the rider, driver profile, vehicle, legs, and the signature blob already in memory (no round-trip needed).
- Upload the bytes to the private `state-pdfs` bucket at `${userId}/${tripId}.pdf`.
- Call a new server function `attachStatePdf({ trip_id, state_pdf_path })` to save the path on `medicaid_trips.state_pdf_path` (column already exists).

Then show a short "Trip submitted" confirmation screen with the rider name, a "View PDF" button (opens a signed URL in a new tab), and a "Done" button that returns to the driver home. This is the "PDF return" the driver expects to see.

### 3. Reviewer sees the stored PDF, not a re-render
In `src/routes/_authenticated/medicaid-billing.tsx`, embed the stored PDF via a signed URL (`<iframe>` inside the review dialog) instead of regenerating on download. Keep a "Download" button that just links to the signed URL. Regeneration remains as a fallback for legacy rows with no `state_pdf_path`.

### 4. "Bill to state" uses the saved PDF
In `src/lib/portalSubmit.functions.ts`, when the admin clicks "Send to portal":
- Create a 15-minute signed URL for `state_pdf_path` and include it in the runner payload as `pdf_url`.
- The HFC runner (`automation/hfc-runner/src/portal.ts`) already logs into the Health First Colorado provider portal with the stored admin credentials — update it to download `pdf_url` and upload that exact file to the portal, then capture the confirmation number and post it back to `/api/public/hfc-callback`, which flips the trip to `submitted` with the confirmation. No manual login, no manual upload.

### 5. Small safety fixes
- Refuse submit if any rider is missing a signature or any leg is missing pickup/drop-off odometer (already partly enforced; tighten messaging).
- Store `state_pdf_generated_at` timestamp so the reviewer can see when the PDF was produced.

## Files touched
- `src/assets/nemt_trip_report_template.pdf.asset.json` (new template)
- `src/lib/medicaidPdf.ts` (recalibrate coordinates for new form)
- `src/lib/nemtTrip.functions.ts` (add `attachStatePdf` server fn)
- `src/routes/driver.trip.new.tsx` (generate + upload PDF, show confirmation screen)
- `src/routes/_authenticated/medicaid-billing.tsx` (embed stored PDF in review)
- `src/lib/portalSubmit.functions.ts` (send signed `pdf_url` to runner)
- `automation/hfc-runner/src/portal.ts` (download `pdf_url` and upload it in the portal flow)
- Migration: add `state_pdf_generated_at timestamptz` to `medicaid_trips`.

## What stays the same
- The 5-step wizard, riders/legs/signature logic, and the review → approve → submit workflow are unchanged.
- The state-pdfs bucket, medicaid_trips schema, HFC runner deployment, and Health First Colorado credentials already exist.

## Out of scope (ask if you want these next)
- Multi-page PDF if the state releases a longer form.
- Emailing the PDF to the rider.
- Bulk "Bill to state" for many approved trips at once.
