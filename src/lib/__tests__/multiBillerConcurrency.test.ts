/**
 * MULTI-BILLER / MULTI-COMPANY CONCURRENCY.
 *
 * The business shape: one HCPF portal login per company, many billers inside
 * that company, and many companies in parallel. Nothing here touches the
 * network — the robot is mocked and the DB is the in-memory fake.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const started: string[] = [];
let failNext: string | null = null;

vi.mock("@/lib/billingHelpers", async () => ({
  startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
    if (failNext) {
      const m = failNext;
      failNext = null;
      throw new Error(m);
    }
    started.push(args.billingRecordId);
    args.trip.robot_job_id = `job-${args.billingRecordId}`;
    args.trip.robot_job_started_at = new Date().toISOString();
  }),
  logAudit: vi.fn(async () => {}),
  looksLikeRetryableTimeout: (m: string) => /timed out|timeout/i.test(String(m ?? "")),
  hasExplicitPreSubmitFailureEvidence: (m: string) => /pre_submit|submit_reached\s*[:=]\s*false|stage\s*[:=]\s*(login|launch|step1)/i.test(String(m ?? "")),
  looksLikePossiblySubmittedTimeout: (m: string) =>
    /SubmitClaimProf3|after clicking (?:Submit|Confirm)/i.test(String(m ?? "")) &&
    /timed out|timeout|closed/i.test(String(m ?? "")),
}));

import { makeFakeDb, makeRecord, type FakeRecord } from "./fakeQueueDb";
import { enqueueSubmissionBatch, getBatchProgress } from "@/lib/submissionBatch.server";
import { clearAccountKeyCache } from "@/lib/submissionAccount.server";
import { buildIdempotencyKey, versionOfKey, nextVersionKey } from "@/lib/submissionIdempotency";
import {
  dispatchLeasedSubmissions,
  leaseSubmissionJobs,
  runSubmissionQueueTick,
  hasPortalClaimEvidence,
  scheduleRetryOrFail,
  maxSubmitPerCompany,
} from "@/lib/submissionQueue.server";

function candidatesFor(records: FakeRecord[], resubmit = false) {
  return records.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    tripId: r.trip_id,
    serviceDate: "2026-08-12T10:00:00.000Z",
    resubmit,
  }));
}

/** Bills that are ready to submit, i.e. not yet queued. */
function approved(id: string, opts: Parameters<typeof makeRecord>[1] = {}) {
  return makeRecord(id, { status: "approved", ...opts });
}

beforeEach(() => {
  started.length = 0;
  failNext = null;
  clearAccountKeyCache();
});

describe("idempotency keys", () => {
  it("is stable for the same intent and versioned for a deliberate resubmit", () => {
    const base = {
      accountKey: "acct:hcpf:co1",
      companyId: "co1",
      tripId: "t1",
      serviceDate: "2026-08-12T10:00:00Z",
    };
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base, version: 1 }));
    expect(buildIdempotencyKey({ ...base, serviceDate: "2026-08-13T10:00:00Z" })).not.toBe(
      buildIdempotencyKey(base),
    );
    const v1 = buildIdempotencyKey(base);
    expect(versionOfKey(v1)).toBe(1);
    expect(versionOfKey(nextVersionKey(v1, base))).toBe(2);
  });
});

describe("three billers, one company, one HCPF account", () => {
  it("collapses overlapping batches and starts exactly one submission", async () => {
    const records = Array.from({ length: 6 }, (_, i) => approved(String(i + 1), { riderId: `r${i}` }));
    const { supabase, batches } = makeFakeDb(records);

    // Overlapping selections from three billers at the same instant.
    const [a, b, c] = await Promise.all([
      enqueueSubmissionBatch(supabase, { actorId: "biller-a", candidates: candidatesFor(records.slice(0, 4)) }),
      enqueueSubmissionBatch(supabase, { actorId: "biller-b", candidates: candidatesFor(records.slice(2, 6)) }),
      enqueueSubmissionBatch(supabase, { actorId: "biller-c", candidates: candidatesFor(records.slice(3, 6)) }),
    ]);

    // Every bill is queued exactly once, whoever won the race.
    const enqueued = [...a!.enqueued, ...b!.enqueued, ...c!.enqueued];
    expect(new Set(enqueued).size).toBe(enqueued.length);
    expect(records.filter((r) => r.status === "queued").length).toBe(6);
    // Every bill carries the shared account key for the company.
    expect(new Set(records.map((r) => r.submit_account_key)).size).toBe(1);
    expect(records.every((r) => Boolean(r.submit_idempotency_key))).toBe(true);
    expect(batches.length).toBe(3);

    // Three simultaneous dispatchers never exceed the account cap.
    const runs = await Promise.all([
      dispatchLeasedSubmissions(supabase, "biller-a", { worker: "a" }),
      dispatchLeasedSubmissions(supabase, "biller-b", { worker: "b" }),
      dispatchLeasedSubmissions(supabase, "biller-c", { worker: "c" }),
    ]);
    const startedIds = runs.flatMap((r) => r.startedIds);
    expect(startedIds.length).toBe(maxSubmitPerCompany());
    expect(new Set(startedIds).size).toBe(startedIds.length);
    expect(new Set(started).size).toBe(started.length);
    expect(records.filter((r) => r.status === "submitting").length).toBe(maxSubmitPerCompany());
    expect(records.filter((r) => r.status === "queued").length).toBe(6 - maxSubmitPerCompany());
  });

  it("re-clicking a queued bill never creates a second job", async () => {
    const rec = approved("1");
    const { supabase } = makeFakeDb([rec]);
    const first = await enqueueSubmissionBatch(supabase, {
      actorId: "biller-a",
      candidates: candidatesFor([rec]),
    });
    const second = await enqueueSubmissionBatch(supabase, {
      actorId: "biller-b",
      candidates: candidatesFor([rec]),
    });
    expect(first.enqueued).toEqual(["1"]);
    expect(second.enqueued).toEqual([]);
    expect(second.duplicates).toEqual(["1"]);
  });
});

describe("two companies, two HCPF accounts", () => {
  it("runs independently — neither blocks the other at the orchestration layer", async () => {
    const records = [
      approved("1", { company: "co-a", riderId: "ra1" }),
      approved("2", { company: "co-a", riderId: "ra2" }),
      approved("3", { company: "co-b", riderId: "rb1" }),
      approved("4", { company: "co-b", riderId: "rb2" }),
    ];
    const { supabase } = makeFakeDb(records);
    await enqueueSubmissionBatch(supabase, { actorId: "biller-a", candidates: candidatesFor(records) });

    const res = await dispatchLeasedSubmissions(supabase, "biller-a", { worker: "w" });
    const startedCompanies = res.startedIds.map(
      (id) => records.find((r) => r.id === id)!.company_id,
    );
    // One per account, both accounts served in the same pass.
    expect(new Set(startedCompanies)).toEqual(new Set(["co-a", "co-b"]));

    // While co-a is busy, co-b can still be dispatched again after it settles.
    const busyA = records.find((r) => r.company_id === "co-a" && r.status === "submitting")!;
    expect(busyA).toBeTruthy();
    const leases = await leaseSubmissionJobs(supabase, { worker: "w2" });
    expect(leases.every((l) => l.company_id !== "co-a" || false)).toBe(true);
  });
});

describe("100-bill batch", () => {
  it("enqueues everything at once and one bad bill never blocks the rest", async () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      approved(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);

    const t0 = Date.now();
    const batch = await enqueueSubmissionBatch(supabase, {
      actorId: "biller-a",
      candidates: candidatesFor(records),
      label: "100",
    });
    expect(batch.enqueued.length).toBe(100);
    expect(Date.now() - t0).toBeLessThan(4000);

    // AUTOMATIC WAVES: all 100 are durably enqueued, but only the first wave of
    // 20 is eligible; the other 80 wait and are released as slots free up.
    const progress = await getBatchProgress(supabase, batch.batchId!);
    expect(progress.queued).toBe(20);
    expect(progress.waiting).toBe(80);
    expect(progress.queued + progress.waiting).toBe(100);
    expect(progress.done).toBe(false);

    // The first bill fails hard on data; the queue keeps moving.
    failNext = "Indicates a required field.";
    const first = await dispatchLeasedSubmissions(supabase, null, { worker: "w1" });
    expect(first.failed).toBe(1);
    // The rest of that pass still ran: one bad bill never blocks the account.
    expect(first.started).toBe(maxSubmitPerCompany() - 1);
    expect(records.filter((r) => r.status === "needs_fix").length).toBe(1);

    const second = await dispatchLeasedSubmissions(supabase, null, { worker: "w2" });
    expect(second.started).toBe(1); // the freed slot is refilled
    expect(records.filter((r) => r.status === "needs_fix").length).toBe(1);
  });
});

describe("safety invariants", () => {
  it("does not resubmit after a timeout that may have submitted", async () => {
    const rec = approved("1");
    const { supabase } = makeFakeDb([rec]);
    const out = await scheduleRetryOrFail(supabase, {
      id: "1",
      tripId: "t1",
      attempt: 0,
      error:
        "Timeout 480000ms exceeded after clicking SubmitClaimProf3; Target page, context or browser has been closed",
      actorId: null,
    });
    expect(out).toBe("failed");
    expect(rec.requires_human_step).toBe(true);
    expect(rec.failure_code).toBe("ambiguous_outcome");
    expect(started.length).toBe(0);
  });

  it("never retries or downgrades a bill that already has a claim id", async () => {
    const rec = approved("1");
    rec.state_confirmation_number = "2326237001236";
    rec.submit_attempt_count = 1;
    rec.submit_last_error = "Robot timed out after 600s";
    expect(hasPortalClaimEvidence(rec)).toBe(true);

    const { supabase } = makeFakeDb([rec]);
    await enqueueSubmissionBatch(supabase, { actorId: "b", candidates: candidatesFor([rec]) });
    // Enqueue clears the retry flags, so restore the evidence-bearing state.
    rec.submit_attempt_count = 1;
    rec.submit_last_error = "Robot timed out after 600s";

    const res = await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    expect(res.blocked).toBe(1);
    expect(res.started).toBe(0);
    expect(started.length).toBe(0);
    expect(rec.state_confirmation_number).toBe("2326237001236");
    expect(rec.requires_human_step).toBe(true);
  });

  it("recovers an expired lease after a worker crash without duplicating work", async () => {
    const rec = makeRecord("1", {
      status: "queued",
      submit_locked_until: new Date(Date.now() - 60 * 60_000).toISOString(),
      submit_worker: "dead-worker",
    });
    const { supabase } = makeFakeDb([rec]);
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.staleLocksReleased).toBe(1);
    expect(tick.started).toBe(1);
    expect(started).toEqual(["1"]);
  });
});
