# Submission throughput: what actually limits us today

Read-only inspection. No data changed, no claim submitted, no code edited, queue untouched.

## Headline finding

Right now the system can only run **one real claim at a time, company-wide** — not 4. The account cap is not the binding limit; the robot fleet registry is.

`robot_workers` currently holds:

```text
worker-1  enabled=true   max_active_jobs=1
worker-2  enabled=false  max_active_jobs=1
```

`effectiveGlobalLimit()` (`src/lib/robotFleet.server.ts:185`) returns `min(SUBMIT_MAX_GLOBAL, fleetCapacity)` when there is one healthy worker → `min(20, 1) = 1`. `dispatchLeasedSubmissions` passes that as `_global_limit` into the lease RPC, so **every tick leases at most one bill globally**, regardless of the per-account cap of 4.

At ~2 min per claim that is a hard ceiling of ~30 claims/hour. 20 bills would take ~40 minutes, not 4–8.

## The full list of limiters (in the order they bite)

1. **Fleet capacity = 1** — `robot_workers.worker-1.max_active_jobs = 1`; `effectiveGlobalLimit` / `fleetCapacity` in `src/lib/robotFleet.server.ts:170-194`. Binding today.
2. **Per-account cap = 4, hard-clamped 1..4** — `maxSubmitPerCompany()` in `src/lib/submissionQueue.server.ts:66` (`envInt("SUBMIT_MAX_PER_COMPANY", 4, 1, 4)`); mirrored by `MAX_CONCURRENT_ROBOT_JOBS = 4` in `src/lib/robotQueue.server.ts:31`. Config cannot raise it above 4 — the clamp is in code.
3. **Global cap** — `maxSubmitGlobal()` = `SUBMIT_MAX_GLOBAL`, default 20 (`submissionQueue.server.ts:68`). Not binding.
4. **Account key scoping** — `resolveAccountKey` (`src/lib/submissionAccount.server.ts`) produces `acct:<portal>:<login>`, stamped onto `billing_records.submit_account_key` at enqueue (`submissionBatch.server.ts:131`, `robotQueue.server.ts` interactive path). The lease RPC `lease_submission_jobs` partitions and counts busy rows by `coalesce(submit_account_key, company_id::text)` — so **all billers in one company share one lane of 4**, and different companies/logins are fully parallel. Billers are *not* serialized against each other beyond that shared cap: overlapping batches collapse by idempotency key, they do not queue behind one another.
5. **Per-rider single flight = 1** — `MAX_CONCURRENT_JOBS_PER_RIDER` (`robotQueue.server.ts:44`), enforced in `dispatchLeasedSubmissions` by releasing the lease (paced, no attempt burnt). If several of the 20 bills are the same member, they serialize regardless of any cap.
6. **Dispatch cadence** — there is **no pg_cron job for `submission-queue-tick`**. Only two cron jobs exist: `poll-robot-jobs` and `sync-claim-status`, both every minute. `poll-robot-jobs` calls `sweepRobotJobs(..., {refill:true})` → `runSubmissionQueueTick` with `refillMaxRounds: 5` and `SUBMIT_REFILL_POLL_MS = 4000`. So refill inside a tick is bounded to 5 rounds × 4 s of polling; beyond that, the next slot waits for the next minute boundary. That adds up to ~60 s of dead time per freed slot at low concurrency.
7. **Lease/backoff constants** — `submitLeaseSeconds` 300 s, `submitStaleGraceSeconds` 300 s, `SUBMIT_RUN_BUDGET_MS` 100 s, `maxSubmitAttempts` 3, `submitInfraCooldownMs` 90 s, `BACKOFF_BASE_MS` 60 s. These only affect failures, not happy-path throughput.

## Concurrency arithmetic for the 20-in-4-to-8-minutes target

Required in-flight concurrency `C = N x runtime / window`:

```text
runtime 2.0 min:  20x2.0 = 40 claim-min  -> 4 min: C=10   8 min: C=5
runtime 1.5 min:  20x1.5 = 30 claim-min  -> 4 min: C=7.5  8 min: C=3.75
```

Add dispatch/reconcile latency (currently up to ~60 s per slot turnover) and you need headroom. Practical answer:

- **C = 4** (today's account cap, if the fleet allowed it): 20 claims in **~8–10 min** — just misses the target at 2 min/claim, meets the loose end at 1.5 min/claim.
- **C = 6**: ~5–7 min. Meets the target.
- **C = 8**: ~4–5 min. Meets the tight end, and matches the automation service's own documented per-account ceiling of 8.

So the target requires **6–8 simultaneous portal sessions on one HCPF login**, plus turnover latency under ~10 s. That exceeds the current hard clamp of 4 and far exceeds the effective limit of 1.

## Safe staged plan (nothing here is a code change yet — approval per stage)

**Stage 0 — restore the intended 4 (config only, no code).**
Set `robot_workers.worker-1.max_active_jobs` to 4. This alone takes effective concurrency from 1 → 4 and is fully reversible. Measure a real 8-bill batch: per-claim runtime, turnover gap, failure rate.

**Stage 1 — close the dispatch latency gap.**
Add a `submission-queue-tick` cron entry (the route already exists at `src/routes/api/public/hooks/submission-queue-tick.ts` and is unscheduled), and/or raise `SUBMIT_REFILL_MAX_ROUNDS` and lower `SUBMIT_REFILL_POLL_MS` so a freed slot refills in seconds instead of at the next minute. Both are env-backed and clamped.

**Stage 2 — raise the per-account clamp, deliberately.**
Change the clamp in `maxSubmitPerCompany()` from `1..4` to `1..8` and align `MAX_CONCURRENT_ROBOT_JOBS`, keeping the default at 4 so nothing changes until `SUBMIT_MAX_PER_COMPANY` is set. Then ramp 4 → 6 → 8 with a measured batch at each step, watching for the known failure signature (Chromium spawn EAGAIN, closed browser, 480 s timeouts). Roll back one step on the first appearance.

**Stage 3 — horizontal capacity instead of deeper per-account concurrency.**
If the portal degrades above 4–6 sessions per login, add worker-2 (or a second portal login). A second login yields a second `submit_account_key` and two fully independent lanes with zero changes to duplicate safety. This is the option that scales without pushing one HCPF session harder.

## Invariants that stay untouched in every stage

- Idempotency keys (`buildIdempotencyKey`) and the conditional `queued -> submitting` flip — duplicate collapsing does not depend on any cap.
- Per-rider single flight stays at 1.
- Tenant isolation: `lease_submission_jobs` scopes to `current_user_company_id()` for non-service callers.
- Needs Verification rules: `hasPortalClaimEvidence`, `parkForVerification`, lost-job/404 handling and the in-flight ceiling all remain as-is.
- No blind retries proposed anywhere. Nothing in this plan retries, resumes, or unpauses anything.

## Recommendation

Stage 0 first, on its own. Going from 1 to 4 is a four-fold gain with no code change and no new risk, and the measurement it produces is what tells us whether Stage 2 (6–8) or Stage 3 (second lane) is the right way to reach 4–8 minutes.
