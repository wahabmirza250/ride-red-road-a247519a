import { describe, it, expect, vi, beforeEach } from "vitest";

const started: any[] = [];
let failNext: string | null = null;

vi.mock("@/lib/billingHelpers", async () => {
  return {
    startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
      if (failNext) {
        const msg = failNext;
        failNext = null;
        throw new Error(msg);
      }
      started.push(args);
      args.trip.robot_job_id = `job-${args.billingRecordId}`;
      args.trip.robot_job_started_at = new Date().toISOString();
    }),
    logAudit: vi.fn(async () => {}),
    looksLikeRetryableTimeout: (m: string) => /timed out|timeout/i.test(String(m ?? "")),
    hasExplicitPreSubmitFailureEvidence: (m: string) => /pre_submit|submit_reached\s*[:=]\s*false|stage\s*[:=]\s*(login|launch|step1)/i.test(String(m ?? "")),
  looksLikePossiblySubmittedTimeout: (m: string) =>
      /SubmitClaimProf3|after clicking (?:Submit|Confirm)/i.test(String(m ?? "")) &&
      /timed out|timeout|closed/i.test(String(m ?? "")),
  };
});

import { makeFakeDb, makeRecord } from "./fakeQueueDb";
import {
  dispatchLeasedSubmissions,
  leaseSubmissionJobs,
  runSubmissionQueueTick,
  recoverOrphanedSubmissions,
  scheduleRetryOrFail,
  submitBackoffMs,
  isTransientSubmitError,
  isAmbiguousSubmitError,
  maxSubmitAttempts,
  maxSubmitPerCompany,
  maxSubmitGlobal,
} from "@/lib/submissionQueue.server";

beforeEach(() => {
  started.length = 0;
  failNext = null;
});

describe("limits", () => {
  it("clamps to safe defaults", () => {
    expect(maxSubmitPerCompany()).toBe(4); // controlled per-account concurrency
    expect(maxSubmitGlobal()).toBe(20);
    expect(maxSubmitAttempts()).toBe(3);
  });
  it("backs off exponentially and caps", () => {
    expect(submitBackoffMs(0)).toBe(60_000);
    expect(submitBackoffMs(1)).toBe(120_000);
    expect(submitBackoffMs(20)).toBe(30 * 60_000);
  });
  it("classifies errors", () => {
    // A bare worker timeout proves nothing about where the run died.
    expect(isTransientSubmitError("Robot timed out after 600s")).toBe(false);
    expect(
      isTransientSubmitError("stage=login: page.goto timed out, submit_reached=false"),
    ).toBe(true);
    expect(isTransientSubmitError("fetch failed")).toBe(true);
    expect(isTransientSubmitError("Member ID is invalid")).toBe(false);
    expect(isAmbiguousSubmitError("confirm page never loaded")).toBe(true);
    expect(
      isAmbiguousSubmitError(
        "Timeout 480000ms exceeded after clicking SubmitClaimProf3; Target page, context or browser has been closed",
      ),
    ).toBe(true);
    expect(
      isTransientSubmitError(
        "Timeout 480000ms exceeded after clicking SubmitClaimProf3; Target page, context or browser has been closed",
      ),
    ).toBe(false);
  });
});

describe("atomic leasing", () => {
  it("never hands the same row to two dispatchers", async () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    const batches = await Promise.all([
      leaseSubmissionJobs(supabase, { worker: "a" }),
      leaseSubmissionJobs(supabase, { worker: "b" }),
      leaseSubmissionJobs(supabase, { worker: "c" }),
    ]);
    const ids = batches.flat().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(Math.min(6, maxSubmitPerCompany())); // capped, never duplicated
  });

  it("is fair across companies: no tenant starves another", async () => {
    const records = [
      ...Array.from({ length: 50 }, (_, i) =>
        makeRecord(`a${i}`, { company: "big", riderId: `ra${i}` }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeRecord(`b${i}`, { company: "small", riderId: `rb${i}` }),
      ),
    ];
    const { supabase } = makeFakeDb(records);
    const leases = await leaseSubmissionJobs(supabase, { worker: "w" });
    const byCompany = leases.reduce<Record<string, number>>((m, l) => {
      m[String(l.company_id)] = (m[String(l.company_id)] ?? 0) + 1;
      return m;
    }, {});
    expect(byCompany["big"]).toBeLessThanOrEqual(maxSubmitPerCompany());
    expect(byCompany["small"]).toBe(2); // only 2 exist, both served
  });

  it("honours the per-company cap against jobs already running", async () => {
    const records = [
      makeRecord("1", { status: "submitting", jobId: "j1", riderId: "r1" }),
      makeRecord("2", { status: "submitting", jobId: "j2", riderId: "r2" }),
      makeRecord("3", { riderId: "r3" }),
      makeRecord("4", { riderId: "r4" }),
      makeRecord("5", { riderId: "r5" }),
    ];
    const { supabase } = makeFakeDb(records);
    const leases = await leaseSubmissionJobs(supabase, { worker: "w" });
    expect(leases.length).toBe(Math.max(0, maxSubmitPerCompany() - 2));
  });
});

describe("dispatch", () => {
  it("starts up to the account cap and clears every lease", async () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.started).toBe(maxSubmitPerCompany());
    expect(started.length).toBe(maxSubmitPerCompany());
    expect(records.filter((r) => r.status === "submitting").length).toBe(maxSubmitPerCompany());
    expect(records.filter((r) => r.status === "queued").length).toBe(6 - maxSubmitPerCompany());
    expect(records.every((r) => r.submit_locked_until === null)).toBe(true);
  });

  it("never starts a second claim for the SAME rider, without burning an attempt", async () => {
    const records = [
      makeRecord("1", { status: "submitting", jobId: "j1", riderId: "riderA" }),
      makeRecord("2", { riderId: "riderA" }),
    ];
    const { supabase } = makeFakeDb(records);
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.startedIds).toEqual([]);
    expect(started.length).toBe(0);
    const parked = records[1]!;
    expect(parked.status).toBe("queued");
    expect(parked.submit_attempt_count).toBe(0);
    expect(parked.submit_locked_until).toBeNull();
  });

  it("stops adding work once the account cap is already in flight", async () => {
    const records = [
      ...Array.from({ length: maxSubmitPerCompany() }, (_, i) =>
        makeRecord(`live${i}`, { status: "submitting", jobId: `j${i}`, riderId: `live-r${i}` }),
      ),
      makeRecord("9", { riderId: "riderZ" }),
    ];
    const { supabase } = makeFakeDb(records);
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.startedIds).toEqual([]);
    expect(records.find((r) => r.id === "9")!.status).toBe("queued");
  });

  it("retries a transient failure with backoff, then stops for a human", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);

    failNext = "stage=login: page.goto timed out, submit_reached=false";
    let res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.retried).toBe(1);
    expect(rec.status).toBe("queued");
    expect(rec.submit_attempt_count).toBe(1);
    expect(new Date(rec.submit_next_attempt_at!).getTime()).toBeGreaterThan(Date.now());

    // still parked while the backoff window is open
    res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.leased).toBe(0);

    rec.submit_next_attempt_at = new Date(Date.now() - 1000).toISOString();
    failNext = "stage=login: page.goto timed out, submit_reached=false";
    res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.retried).toBe(1);
    expect(rec.submit_attempt_count).toBe(2);

    rec.submit_next_attempt_at = new Date(Date.now() - 1000).toISOString();
    failNext = "stage=login: page.goto timed out, submit_reached=false";
    res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.failed).toBe(1);
    expect(rec.status).toBe("needs_fix");
  });

  it("never auto-retries a data-validation failure", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    failNext = "Indicates a required field.";
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.failed).toBe(1);
    expect(rec.status).toBe("needs_fix");
    expect(rec.submit_attempt_count).toBe(1);
  });

  it("parks Step 1 required-field failures for verification without retry", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    failNext = "Still on Step 1 after clicking Continue. Errors: Error | * Indicates a required field.";
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.failed).toBe(1);
    expect(rec.status).toBe("needs_fix");
    expect(rec.requires_human_step).toBe(true);
    expect(rec.submission_error).toMatch(/Portal Step 1 validation failed/i);
    expect(started.length).toBe(0);
  });
});

describe("crash safety", () => {
  it("routes an orphaned in-flight row to human attention, never a resubmit", async () => {
    const rec = makeRecord("1", {
      status: "submitting",
      riderId: "rA",
      updated_at: "2020-01-01T00:00:00.000Z",
    });
    const { supabase } = makeFakeDb([rec]);
    const n = await recoverOrphanedSubmissions(supabase);
    expect(n).toBe(1);
    expect(rec.status).toBe("needs_fix");
    expect(rec.requires_human_step).toBe(true);
    expect(started.length).toBe(0);
  });

  it("releases abandoned leases so the work becomes eligible again", async () => {
    const rec = makeRecord("1", {
      riderId: "rA",
      submit_locked_until: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const { supabase } = makeFakeDb([rec]);
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.staleLocksReleased).toBe(1);
    expect(tick.started).toBe(1);
  });
});

describe("pause switch", () => {
  it("stops every tick while paused and records why", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase, queueState } = makeFakeDb([rec], {
      paused: true,
      pause_reason: "Portal maintenance",
    });
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.ran).toBe(false);
    expect(tick.reason).toBe("Portal maintenance");
    expect(rec.status).toBe("queued");
    expect(started.length).toBe(0);
    expect(queueState.last_run_at).toBeTruthy();
  });
});

describe("scheduleRetryOrFail", () => {
  it("flags ambiguous outcomes for a human instead of retrying", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    const out = await scheduleRetryOrFail(supabase, {
      id: "1",
      tripId: "t1",
      attempt: 0,
      error: "Confirm was clicked but the page timed out",
      actorId: null,
    });
    expect(out).toBe("failed");
    expect(rec.requires_human_step).toBe(true);
  });
});

/**
 * PRE-SUBMIT PACING (single-flight boundary + browser launch failure).
 *
 * Nothing reached HCPF in either case, so the bill must go back to `queued`
 * with no attempt burnt and must never appear as a rejection / Needs Fix.
 */
describe("pre-submit pacing never burns an attempt", () => {
  const ACCOUNT_BUSY =
    "Another portal session is already running on this provider account — the automation service is temporarily unavailable for this bill. Nothing was submitted; it stays queued.";

  it("requeues an account-busy dispatch failure with no attempt and no human flag", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    failNext = ACCOUNT_BUSY;
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.failed).toBe(0);
    expect(res.retried).toBe(0);
    expect(res.paced).toBe(1);
    expect(rec.status).toBe("queued");
    expect(rec.submit_attempt_count).toBe(0);
    expect(rec.requires_human_step).toBe(false);
    expect(rec.submit_locked_until).toBeNull();
    expect(rec.submission_error).not.toMatch(/reject|fail/i);
    expect(rec.failure_code).toBe("account_busy");
  });

  it("stays queued across repeated account-busy dispatches (never needs_fix)", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    for (let i = 0; i < 5; i++) {
      rec.submit_next_attempt_at = new Date(Date.now() - 1000).toISOString();
      failNext = ACCOUNT_BUSY;
      await dispatchLeasedSubmissions(supabase, "actor");
    }
    expect(rec.status).toBe("queued");
    expect(rec.submit_attempt_count).toBe(0);
    expect(rec.requires_human_step).toBe(false);
  });

  it("scheduleRetryOrFail reports 'paced' for the account-busy message", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    const out = await scheduleRetryOrFail(supabase, {
      id: "1",
      tripId: "t1",
      attempt: 2, // already near the attempt ceiling — still must not fail
      error: ACCOUNT_BUSY,
      actorId: null,
    });
    expect(out).toBe("paced");
    expect(rec.status).toBe("queued");
    expect(rec.submit_attempt_count).toBe(0);
  });

  it("treats a browser-launch EAGAIN as pre-submit capacity, queued with backoff", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    const out = await scheduleRetryOrFail(supabase, {
      id: "1",
      tripId: "t1",
      attempt: 0,
      error: "browserType.launch: spawn chrome EAGAIN (pthread_create failed)",
      actorId: null,
    });
    expect(out).toBe("paced");
    expect(rec.status).toBe("queued");
    expect(rec.submit_attempt_count).toBe(0);
    expect(rec.requires_human_step).toBe(false);
    expect(new Date(rec.submit_next_attempt_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it("still parks an ambiguous post-Submit timeout even if it mentions launch text", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    const out = await scheduleRetryOrFail(supabase, {
      id: "1",
      tripId: "t1",
      attempt: 0,
      error:
        "Timeout after clicking SubmitClaimProf3; browserType.launch recovery failed",
      actorId: null,
    });
    expect(out).toBe("failed");
    expect(rec.status).toBe("needs_fix");
    expect(rec.requires_human_step).toBe(true);
  });
});
