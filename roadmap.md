# RedArt roadmap

## In progress — Super EDI end-to-end (bulk-first)

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

## Blocked (needs the user / external accounts)

- EDI bridge `redart-edi-bridge` is not reachable from this project (function not found) and no
  EDI backend credentials are configured, so no live TEST round-trip can be proven from here.
  Needed (any one): the bridge deployed to this project, `EDI_BRIDGE_URL` (+ `EDI_BRIDGE_KEY`)
  pointing at the existing bridge, or `EDI_API_BASE_URL` + `EDI_API_TOKEN`. The workspace now
  states this in-app and re-probes on demand.

## Ready next

- Persist 999/277/835 detail into a dedicated table once the backend documents those endpoints.
- Auto-refresh EDI statuses on a schedule (cron) once the backend exposes a bulk status endpoint.
