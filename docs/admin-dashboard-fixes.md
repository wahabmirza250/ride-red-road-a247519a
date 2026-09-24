# Admin dashboard fixes — September 24, 2026

Changes addressing the 20 review findings:

1. Local pickup time formatting, UTC conversion only on save, DST-gap validation.
2. Labeled tablet sidebar and complete phone More menu.
3. Map authorization/load failures switch to the existing OpenStreetMap renderer and retain the driver list.
4. Shared Live/Stale/Offline/No location calculation; GPS becomes stale after 90 seconds.
5. Admin pages no longer publish driver GPS.
6. Transactional assignment preview/confirmation checks company, availability, fresh location, schedule conflicts and supported vehicle constraints. Scheduling uses the same checks and explains saved-but-unassigned results.
7. Active work is separated from future scheduled pickups.
8. License status reports Unverified or Not provided instead of falsely claiming Active.
9. Reports, Salary, driver pay views and exports use the same pay-plan calculation; unpaid work and recorded payments are separate.
10. Unified Trips combines dispatch rides, requests, driver drafts and completed reports, labeling sources and deduplicating linked active drafts.
11. Server-side filters, counts and 50-row pages replace the 200-row cut-off.
12. Operational query failures show unavailable/stale data and Retry controls.
13. Company-aware active navigation and page titles.
14. URL-backed trip filters, dispatch dates, billing tabs/stages and salary dates.
15. Driver chat and history links preserve selected driver.
16. Embedded billing quick actions stay inside admin.
17. Company setup groups provider, portal, rate, messaging and device readiness.
18. Inline passenger creation retains and updates the New trip form.
19. Today prioritizes queues, fleet state, next pickups and attention items; driver profiles open explicitly.
20. Small-screen notifications, accessible action labels and keyboard-reachable trip details.

Validation: TypeScript and production build passed. All 117 test files / 1,068 tests passed, including time/DST and GPS freshness tests. Rolled-back database fixtures verified 251-row pagination, earliest-first ordering, non-mutating preview, idempotence, conflicting/stale/cancelled assignment rejection and unauthorized access rejection. An authenticated database read was also checked. No real rides, claims, messages or payments were submitted.

Limits: The managed Google key rejects the Railway hostname. Alternate maps are implemented; Google address search still requires an authorized browser key. Provider, portal and messaging credentials are reported as configured/missing, not invented. New trip displays the device timezone because no company timezone is stored. Licenses cannot be called verified without expiry/verification records. Domain DNS and Android hardware testing are separate from this admin release. Responsive production verification follows deployment.
