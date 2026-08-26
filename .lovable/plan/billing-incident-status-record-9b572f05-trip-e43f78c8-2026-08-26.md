# Billing incident status: record 9b572f05 / trip e43f78c8

Read-only inspection only. No data was modified, nothing was submitted, enqueued, retried or resumed.

## What the production data shows

Timeline for this bill (account `acct:hfc-colorado:londonalfieri22`, service date 08/14/2020):

```text
15:16:34  queued_for_batch_submit   batch d615464c… (12 bills)
15:41:49  robot_payload_prepared    mode=confirm_submit, click_submit=true
15:41:50  robot_started_from_queue  (attempt 1)
15:50:01  auto_retry_timeout        "Portal timed out — automatic retry 1 of 2 queued.
                                     Portal detail: Job timed out after 480s."
16:11:06  robot_payload_prepared    mode=confirm_submit, click_submit=true  (attempt 2)
16:11:06  robot_started_from_queue
16:12:22  last robot status check   robot_last_status = running
16:20:15  queue tick                paused, 0 leased / 0 started
```

Current state:
- Bill: `status = submitting`, `auto_retry_count = 1`, no `state_confirmation_number`, no `submit_last_error`, lease started 16:11:05, heartbeat 16:11:05.
- Trip: `robot_job_id = trip-e43f78c8-…-full-1787760665936-1787760666266`, `robot_last_status = running`, `portal_status = not_sent`, no `robot_confirmation_number`, no `submitted_confirmation`, `submitted_at` null.
- Batch d615464c has 12 bills; exactly 1 (this one) is still `submitting`.
- Queue is paused with reason "Production billing incident containment…", last tick did nothing.

## Answer to the two questions

1. **Did the retry reach Submit/Confirm?** Unknown, and the database contains no evidence either way. The retry was dispatched in `confirm_submit` mode with `click_submit = true`, so it was capable of pressing Submit/Confirm; the job never reported a terminal outcome (`running` since 16:12:22, no error message recorded). This is an ambiguous outcome, not a proven pre-Submit failure.
2. **Any confirmation?** No. No confirmation number exists anywhere for this bill or trip (`state_confirmation_number`, `robot_confirmation_number`, `submitted_confirmation` all null; `portal_status = not_sent`, which only reflects that our side never recorded a send, not the portal's truth).

Because the outcome is ambiguous, this bill must be resolved by the read-only portal claim search / submitted-unverified path — it must not be resubmitted. Attempt 1 was auto-retried purely on the string "Job timed out after 480s", which is exactly the behaviour the safety patch removes; a duplicate claim at HCPF is therefore possible and only a read-only lookup can rule it out.

## Safety patch verification

The patch from commit `05d28ecd` ("Hardened timeout retry logic") is present and current in the codebase:
- `src/lib/billingHelpers.ts:954` — `hasExplicitPreSubmitFailureEvidence()`; `looksLikeRetryableTimeout()` now requires it.
- `src/lib/submissionQueue.server.ts:106` — timeout-like errors without that evidence are not transient.
- Under the patched rule, "Job timed out after 480s" yields no evidence, so the 15:50 auto-retry would not have happened.

Note: `05d28ecd` is the latest commit but has **not** been deployed (publish was deliberately withheld), so production still runs the old rule while the queue stays paused.

## Proposed next step (nothing executed yet)

When you are ready, the safe sequence is:

1. Keep the queue paused; keep worker-2 disabled.
2. Run a **read-only** HCPF claim search for member `…3706`, DOS 08/14/2020, this provider account, to determine whether one, two, or zero claims exist.
3. Depending on the result, record the outcome on the existing bill through the submitted-unverified reconciliation path (or clear it to needs_fix if the portal has nothing) — preserving the original job id, idempotency key `acct:hfc-colorado:londonalfieri22|e43f78c8-…|2020-08-14|v1`, account lock and audit trail.
4. Only after that, deploy the patched build and resume the queue.

Tell me which of these you want me to prepare, and whether step 2 should be a code path I add or a lookup you run manually.
