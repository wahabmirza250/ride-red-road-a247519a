# Walla billing / payroll / compliance upgrade

This is a large build (7 feature areas, ~6 new tables, 2 storage buckets, new PDF output). I want your sign-off on the shape before I start writing migrations, because several pieces touch the live HCPF submission path.

Nothing in the current submission queue, single-flight locking, claim statuses, driver pay math (`src/lib/payPlans.ts`), or tenant isolation changes. Everything below is additive.

## Phase 1 — Payroll from Claim History

New table `payroll_items` (company-scoped): driver, source kind (`claim` | `manual` | `adjustment`), ref trip id, service date, passenger, description, amount, category, payroll status (`not_added` | `added` | `paid`), payout id, created_by, notes, timestamps.

- Unique partial index on `(company_id, ref_id)` where kind = `claim` → the same claim can never be added to payroll twice, enforced in the database, not the UI.
- Claim History gains: driver grouping, filters (date range, passenger, claim status, payroll status), and columns for billed amount, driver pay amount, payroll status badge, paid date, and source.
- **Claim status and payroll status stay independent.** A Medicaid-Paid claim starts at `Not Added`; nothing infers `Paid`.
- Multi-select rows → "Add to Payroll" (idempotent server fn; concurrent billers collapse onto one row).
- Per-driver summary header: total claims, Paid/Submitted/Denied/Needs-Attention counts, payroll-eligible, already-paid, remaining.

## Phase 2 — Manual payroll items + PDF

- "+ Manual Payroll Item" dialog (company, driver, date, optional passenger, description, amount, category, notes), MANUAL badge, created_by/audit row in `billing_audit_log`-style `payroll_audit_log`.
- Negative amounts allowed only under kind `adjustment` so existing payout math can't be silently inverted.
- Print Payroll + Download PDF for a driver/period and for a payout batch: company header, driver, period, claim rows, manual items, totals, adjustments, final payable, generated timestamp. Print-optimized route like the existing `payroll.$driverId` print page.

## Phase 3 — Same member + same service date warning

- Pre-queue check: same company + same Medicaid member + same DOS with more than one trip → non-blocking warning banner in the review/submit path: "Multiple trips found for this member on this service date."
- No automatic modifier, no automatic merge, no change to claim creation. Blocking nothing; biller decides.

## Phase 4 — Denied / resubmission workflow

New table `claim_resubmissions` + `claim_service_line_modifiers`.

- "Prepare Resubmission" from a denied claim creates a NEW draft linked to the original; the original claim row, HCPF claim ID, denial reason, and history are immutable.
- Draft edit mode allows per-service-line modifiers, with `76 — Repeat Procedure by Same MD` offered as a manual choice only. **Never auto-applied.**
- Every modifier add/remove writes actor, timestamp, optional reason.
- Unique index on `(original_trip_id, status in draft/active)` → two billers or a double-click cannot create two live resubmissions.
- Queue path reuses the existing account-scoped single-flight queue unchanged.

## Phase 5 — Driver documents & compliance

New table `driver_insurance_docs` + private storage bucket `driver-docs`.

- Fields: insurer, policy number, vehicle, effective/expiration date, file, notes, status (`pending` | `verified` | `rejected`).
- Derived state: Valid / Expiring Soon / Expired, with dashboard alerts at 30/14/7 days.
- Driver can upload and replace their own; admin verifies. RLS: driver sees own, admin/dispatch sees own company only.

## Phase 6 — Vehicle expenses & maintenance

New table `vehicle_expenses` + reuse of the receipts bucket.

- Driver mobile upload: vehicle, date, category (Oil Change, Tires, Repair, Inspection, Maintenance, Car Wash, Fuel, Other), amount, odometer, vendor, notes, receipt file.
- Admin view: history and totals by vehicle / driver / date range / category.
- Original receipt path preserved; owner recorded; strict company scoping.

## Phase 7 — Tests and verification

New/extended tests for: duplicate payroll prevention, manual item audit, claim/payroll status separation, same-member same-date warning, resubmission linkage, service-line modifier persistence, duplicate resubmission prevention, insurance expiry buckets, maintenance receipt ownership/tenant isolation, role permissions. Full suite + typecheck must be green. No live HCPF claim is submitted at any point.

## Technical notes

- All new public tables get GRANTs + RLS scoped through the existing `current_user_company_id()` / `has_role()` helpers.
- Claim History moves to server-side pagination + filtering; the current 500-row unpaginated fetch does not scale to payroll use.
- Existing components are extended (`ClaimsHistoryTab`, `BillingWorkspace`, driver profile) rather than replaced, so the design system and dark mode carry over.

## Sequencing

I'll ship Phase 1+2 first (migration → server fns → UI → tests), then 3+4, then 5+6, running the full suite after each group. Say the word and I'll start with the Phase 1 migration.
