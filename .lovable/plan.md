
## What we're building

A single app with three role-based sections that share one database:

1. **Driver** — fills out the Colorado Medicaid trip form on their phone
2. **Rider (Passenger)** — a signature tab the driver hands over so the rider signs once and their profile is saved
3. **Admin/Billing** — reviews completed trips, approves them, exports the state-form PDF, and marks each bill as submitted

All three views live in this project under role-gated routes.

---

## Flow

```text
Driver taps "New Trip"
   │
   ├─ Types rider name  →  matches on name + Medicaid ID
   │     ├─ Existing rider  →  profile auto-fills
   │     └─ New rider       →  quick "Add rider" form
   │
   ├─ Fills: pickup date/time, pickup addr, dropoff addr,
   │         odometer start, odometer end, miles (auto-calc, editable)
   │
   ├─ Hands phone to rider  →  "Rider signature" tab
   │     └─ Rider signs on-screen, taps Confirm
   │
   └─ Submit trip  →  status = pending_review
                       │
                       ▼
              Admin billing queue
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
   Approve         Request fix       Reject
       │
       ▼
   Generate filled state-form PDF (matches the paper form)
       │
       ▼
   Admin downloads PDF, submits on state site manually
       │
       ▼
   Admin clicks "Mark submitted"  →  logs date + confirmation #
```

Because there's no state API, "auto-bill after review" means: the system produces the ready-to-submit PDF, tracks who approved it, and records submission — the human only uploads to the state site.

---

## Screens

**Driver**
- Trip list (today / week)
- New Trip form (single scrollable page, mobile-first)
- Rider search + "Add new rider" modal
- Signature tab (fullscreen canvas, "Pass to rider" header)
- Trip detail (see status: pending / approved / submitted)

**Rider profile store** (populated once, reused forever)
- Full name, Medicaid ID, DOB, phone, home address, notes

**Admin / Billing**
- Queue: pending review, approved, submitted, rejected
- Trip detail with signature preview + all fields + rider profile
- Approve / Request fix / Reject buttons
- "Download state PDF" + "Mark submitted" (confirmation # + date)
- Simple totals: trips this week, miles, submitted vs pending

---

## Data (new tables)

- `riders` — name, medicaid_id (unique), dob, phone, address, notes, created_by_driver
- `medicaid_trips` — driver_id, rider_id, pickup_at, pickup_address, dropoff_address, odometer_start, odometer_end, miles, signature (PNG in storage), status, submitted_confirmation, submitted_at, reviewed_by, review_notes
- Storage buckets: `signatures`, `state-pdfs`

RLS: drivers see only their own trips + riders they've created or used; admins see everything.

---

## Roles

Extends the existing `user_roles` table with a `billing_admin` role (or reuses `admin`). Drivers and admins are the only sign-in roles; riders don't log in — they just sign on the driver's device.

---

## Open items before build

1. **The Colorado state PDF you mentioned** — please attach it. I need it to (a) match exact field labels, (b) generate a filled PDF that looks like the real form (`pdf-lib` fills the actual PDF).
2. If no PDF arrives, I'll ship a generic printable trip receipt as a placeholder and swap it in once you upload the form.

---

## Technical notes

- Signature capture: `react-signature-canvas`, saved as PNG to `signatures` bucket
- PDF generation: `pdf-lib` in a `createServerFn`, output stored in `state-pdfs` bucket
- Rider search: server function with `ilike` on name + exact match on Medicaid ID
- Mileage auto-calc = `odometer_end - odometer_start`, editable in case of detours
- Realtime: admin queue subscribes to `medicaid_trips` inserts so new trips appear live
- All three views are the same app — role gate decides which nav they see after login
