## Goal

When a driver completes the Trip Report in the dashboard, the PDF returned (and stored to Medicaid Billing) must be the **exact Colorado HCPF "Non-Emergent Medical Transportation Trip Log" form**, with every field the driver filled in populated in the correct box — not a coordinate-guessed overlay, and not a generic summary.

## Why the current output looks off

Today `src/lib/medicaidPdf.ts` opens a **flattened** copy of the template and draws text at hard-coded x/y coordinates. Small font/scale differences shift text, checkboxes are approximated with an "X" glyph, and the signature stamp can drift. That's the "problem" you're seeing.

The newly uploaded PDF (`Non-Emergent_Medical_Transportation_Trip_Log_042025_Accessible-5.pdf`) is the **fillable** version of the same form — it ships 28 real AcroForm fields with exact names. Filling those fields is deterministic and always renders in the right place.

## What will change

1. **Replace the template asset** with the fillable April-2025 PDF (uploaded).
2. **Rewrite `src/lib/medicaidPdf.ts`** to fill AcroForm fields via `pdf-lib` (already a dependency) instead of coordinate drawing.
3. **Stamp the captured signature PNG** into the "Members Signature" widget's rectangle, then remove that signature field so the image is the visible signature.
4. **Flatten the form** at the end so the downloaded / printed PDF is locked and matches the state's expected paper output exactly.
5. Keep the existing storage + Medicaid Billing wiring unchanged — same `state-pdfs/{driver}/{trip}.pdf` path, same `attachStatePdf` call, same billing retrieval flow.

## Field mapping (driver form → PDF field)

Text fields (`/Tx`)
- Members Name ← rider full name
- Member Health First Colorado ID ← rider medicaid_id
- Trip Date ← leg 1 date
- "Member facility or escort may sign… Escort Name if applicable" ← escort name (blank if none)
- Drivers Name ← driver's full name from profile
- Vehicle License Plate or VIN ← plate (+ "VIN …" if provided)
- Leg 1: Date, Pickup TIme, Pickup Odometer Reading, Pickup Street Address City State Zip, Actual DropOff Time AM PM, Destination Odometer Reading, Dropoff Destination Street Address City State Zip
- Leg 2: same fields with `_2` / `pickup time 2` suffixes (only filled when round-trip)

Radio groups (`/Btn`) — exact export values discovered from the PDF
- `type of trip` → `one way` | `round trip`
- `type of vehicle` → `ground ambulance` | `wheelchair van` | `stretcher van` | `taxi` | `Mobility/Ambulatory vehicle`
- `driver verify member identity` → `yes` | `no`
- `pick up time` / `dropoff time` (leg 1) → `AM` | `pm`
- `second pickup time` / `second dropoff time` (leg 2) → `am` | `pm`

Signature (`/Sig`)
- `Members Signature` — read the widget's `/Rect`, draw the captured PNG scaled to fit inside it, then delete the field. If the trip was signed by an escort, append " (signed by escort)" as small text under the signature.

## Files touched

- **Add** the fillable template as a Lovable asset: `src/assets/nemt_trip_report_template.pdf.asset.json` (replaces current pointer, same import path so no other code changes).
- **Rewrite** `src/lib/medicaidPdf.ts` — AcroForm fill + signature stamp + flatten. Same exported `generateStateFormPdf(args)` signature, so `src/routes/driver.trip.new.tsx` and any other caller keep working with no edits.

## Out of scope

- No DB schema changes.
- No changes to Medicaid Billing UI, storage bucket, or the submit-to-portal path — Billing already pulls `state_pdf_path`; the file at that path just becomes a much cleaner render.
- No changes to the driver dashboard form fields or the autocomplete/passenger-profile flow — those are already wired.

## Technical notes

- `pdf-lib`'s `PDFForm` supports `getTextField`, `getRadioGroup().select()`, and per-field `enableReadOnly()` before `flatten()`. All work in the browser bundle already used by the driver app.
- Radio option strings are case-sensitive and must match the export values above verbatim (that's why AM vs am/pm looks inconsistent — it's what the state's PDF ships).
- Legs missing on a one-way trip simply leave the `_2` fields untouched (blank on the flattened output, matching how a paper form is left blank).
- Any field that isn't present on a future template revision is guarded with a try/catch so a template swap can never crash the export.
