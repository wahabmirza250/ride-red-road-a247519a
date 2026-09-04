# RedArt roadmap

## Done — Claim-number reconciliation & honest claim states (safety patch)

- [x] `claimConfirmation`: a portal claim number is exactly 13 digits; a trip whose confirmation
      columns disagree is refused, never guessed.
- [x] `confirmationReconcile` (+ `.server`): attaches a missing claim number ONLY with a
      13-digit agreed number, an exact `robot_submitted` audit naming it, a LATER read-only portal
      check naming the same claim, no other bill (or corrected resubmission) owning it, and never on
      a corrected draft. One atomic conditional write, one deduplicated audit line, no submit/retry.
- [x] Wired into the queue tick ahead of the pause check, so it also runs while submissions are
      paused (it is read-only towards HCPF).
- [x] `logAuditOnce`: recovery sweeps can no longer write the same audit sentence hundreds of times.
- [x] Corrected verification now excludes claim ids used by ANY bill or resubmission, in any company.
- [x] `claimStateSemantics` + `ClaimStatePill`: evidence-free "submitted/approved/paid/denied" reads
      "Awaiting portal verification"; a never-sent `approved` bill still reads "Ready to submit".
- [x] `robotWorkerHealth`: displayed worker health needs a successful answer inside 10 minutes;
      stale answers and error streaks show as "not answering"/degraded with a plain reason.
- [x] Tests: 42 new (confirmation rules, attach/blocked/noop decisions, atomic + idempotent writer,
      duplicate + original-claim collisions, corrected no/multiple match, worker staleness, state
      semantics). Suite: 1024 passing, typecheck clean.
- [x] Production check (read-only): 7 bills carry a 13-digit trip confirmation with no bill claim
      number — 6 are corrected drafts and 1 has a confirmation already owned by another bill, so the
      reconciler attaches nothing today and no production row was modified.



## Done — Super EDI end-to-end (bulk-first)

- [x] Documented endpoint contract only (`/edi-files/generate-837p/`, `/edi-files/{id}/upload/`,
      `/submission-batches/{id}/add-claim/`); remove invented paths.
- [x] Remove the local 50-mile long-distance assumption; display backend document/long-distance result.
- [x] Routing: `/medicaid-billing` choice screen → `/medicaid-billing/hcpf` (unchanged) and
      `/medicaid-billing/super-edi` (new workspace).
- [x] Server-side EDI transport (bridge first, optional direct upstream), never in the browser.
- [x] Bulk Upload/Import reusing the existing paper-bill inbox + existing electronic records.
- [x] Batch Review: multi-select, Validate All, per-row backend readiness, bad rows never block ready rows.
- [x] Bulk submission: one batch → one 837P → explicit TEST upload; production requires typed confirmation.
- [x] Provider/company onboarding UI incl. shared vs company-specific transport.
- [x] Claim Status / Remittance list driven by documented backend data only.
- [x] Tests: bulk-ready filtering, `ready` semantics, no local mileage threshold, documented paths.
- [x] Connection onboarding: actionable "backend not connected" banner + Test connection, and
      backend-dependent actions (Validate All / build batch / upload) disabled with the reason.
- [x] Third transport option `EDI_BRIDGE_URL` (+ optional `EDI_BRIDGE_KEY`) for a bridge that lives
      outside this project, so no code change is needed to point at it.

## Done — Super EDI security + live-integration audit

- [x] DB verified on the connected production project: `edi_company_settings`, `edi_company_mapping`,
      `edi_entity_links`, `edi_batches` all exist with RLS on and company-scoped read/write policies
      (`is_platform_owner() OR (company_id = current_user_company_id() AND billing/admin role)`).
- [x] Browser-reachable EDI proxy reduced to two tenant-neutral read-only paths (health, catalog);
      every id-bearing operation now goes through vetted, ownership-checked server functions.
- [x] Ownership layer (`ediOwnership.server`): a claim / batch / 837P file id must map to a
      `billing_records` row or `edi_batches` ledger row of the caller's company, resolved from
      `resolveEdiScope` — never from the browser. "Not yours" and "does not exist" read identically.
- [x] Contract aligned with the backend guide: batch create sends `{batch_number, trading_partner,
      environment}` only, claims are attached with `add-claim/`, and claims are created through
      provider → patient → NEMT trip → `/claims/from-trip/`, with entity paths read from the
      backend's own catalog instead of guessed.
- [x] Company onboarding sync (`Sync to EDI backend` in Provider Setup) stores backend ids in
      `edi_company_mapping`; idempotent by fingerprint, non-secret fields only.
- [x] Offline TEST smoke run over the real pipeline with a stubbed transport: catalog → provider →
      partner → patient → trip → claim → validate → batch → add-claim → 837P, stopping before
      `/upload/`, plus cross-tenant refusals that send nothing.
- [x] Regression tests: 30 new (`ediTenantIsolation`, `ediSmokeTest`); suite green.

## Blocked (needs the user / external accounts)

- EDI bridge `redart-edi-bridge` is not reachable from this project (function not found) and no
  EDI backend credentials are configured, so no live TEST round-trip can be proven from here.
  Needed (any one): the bridge deployed to this project, `EDI_BRIDGE_URL` (+ `EDI_BRIDGE_KEY`)
  pointing at the existing bridge, or `EDI_API_BASE_URL` + `EDI_API_TOKEN`. The workspace now
  states this in-app and re-probes on demand.
- Optional: `EDI_SHARED_TRADING_PARTNER_ID` to point every "RedArt shared" company at one approved
  trading partner instead of creating one per company.

## Ready next

- Persist 999/277/835 detail into a dedicated table once the backend documents those endpoints.
- Auto-refresh EDI statuses on a schedule (cron) once the backend exposes a bulk status endpoint.
- Pre-existing DB linter warnings (unrelated to EDI): 54 `SECURITY DEFINER` functions are
  EXECUTE-able by `anon`/`authenticated`, and one extension lives in `public`. Tighten grants
  function-by-function in a dedicated pass — each needs a behaviour check first.

## Ready next — DB EXECUTE-grant hardening (investigated, not yet applied)

Scan (2026-09-01) is 5 warn-level findings, no errors. Inventory gathered for the
`SECURITY DEFINER` EXECUTE pass so it can be applied as one reviewed migration:

- Safe to revoke from `anon`/`PUBLIC` (never called by a browser session, guarded
  internally anyway): `get_portal_credential_for_submission`, `record_robot_worker_health`,
  `company_is_active`, `current_user_is_billing`, `current_user_can_bill` (anon only —
  `authenticated` must keep it: used by storage `state-pdfs`/`signatures` policies),
  `current_user_sees_all_bills`, `is_staff_conversation_member`.
- Safe to reduce to `service_role` only (server/robot callers use the admin client):
  `lease_submission_jobs`, `release_stale_submission_locks`, `release_stale_claim_status_locks`.
- All trigger-returning functions can lose `PUBLIC`/`anon`/`authenticated` EXECUTE
  (Postgres checks EXECUTE at `CREATE TRIGGER`, not at fire time).
- MUST keep `authenticated`: every function referenced in a policy expression
  (`has_role`, `current_user_has_role`, `current_user_company_id`, `current_user_is_dispatch`,
  `owner_unscoped`, `company_of_*`, `driver_can_see_*`, `can_view_driver_media`,
  `is_platform_owner`) plus RPCs the UI calls directly (`set_passenger_ssn`, `set_rider_ssn`,
  `copy_passenger_ssn_to_rider`, `upsert_portal_credential`, `portal_credential_fingerprint`,
  `set_default_billing_portal`, `set_default_billing_provider`, `requests_on_route`,
  `get_ride_request_view`). `get_public_trip_track` must keep `anon` (public tracking page).
- `ride_requests` impersonation finding: INSERT is already checked
  (`WITH CHECK (passenger_id = auth.uid())`) and the passenger ALL policy re-checks it,
  so a passenger cannot forge. Remaining gap is narrow: the driver UPDATE policy has no
  `WITH CHECK`, so a claiming driver could in principle rewrite `passenger_id`. Fix with a
  `guard_ride_request_driver_update` trigger mirroring `guard_trip_driver_update`
  (driver may change only `driver_id`/`status`/offer fields).
- `state_portal_credentials.password_secret_id` is never selected by app code — column-level
  REVOKE from `authenticated` is safe defence-in-depth.
- `rewards_settings` readable by any signed-in user is intentional (contest UI).
