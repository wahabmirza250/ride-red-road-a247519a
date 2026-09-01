# RedArt roadmap

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
