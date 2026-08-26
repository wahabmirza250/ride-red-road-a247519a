/**
 * PRODUCTION STABILITY GUARANTEES for HCPF submission orchestration.
 *
 * Nothing here touches the live automation service: `startRobotSubmission` is
 * mocked and any real fetch throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const started: any[] = [];
let failNext: string | null = null;

vi.mock("@/lib/billingHelpers", () => ({
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
}));

import { makeFakeDb, makeRecord } from "./fakeQueueDb";
import { enqueueOrStartRobot, MAX_CONCURRENT_ROBOT_JOBS } from "@/lib/robotQueue.server";
import {
  dispatchLeasedSubmissions,
  runSubmissionQueueTick,
  maxSubmitPerCompany,
  hasPortalClaimEvidence,
  scheduleRetryOrFail,
  submitInfraCooldownMs,
  isTransientSubmitError,
} from "@/lib/submissionQueue.server";
import {
  isInfrastructureSubmitError,
  sanitizeSubmitError,
  INFRA_USER_MESSAGE,
  PORTAL_STEP1_USER_MESSAGE,
} from "@/lib/submitErrors";

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  started.length = 0;
  failNext = null;
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("NETWORK CALL ATTEMPTED IN TEST MODE");
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("strict single flight", () => {
  it("caps a provider account at one live submission", () => {
    expect(MAX_CONCURRENT_ROBOT_JOBS).toBe(1);
    expect(maxSubmitPerCompany()).toBe(1);
  });

  it("starts one bill and queues the rest, then releases them one at a time", async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);

    const first = await dispatchLeasedSubmissions(supabase, "actor");
    expect(first.started).toBe(1);
    expect(records.filter((r) => r.status === "submitting").length).toBe(1);

    // Nothing else may start while the session is live.
    const second = await dispatchLeasedSubmissions(supabase, "actor");
    expect(second.started).toBe(0);

    // Terminal state → exactly one more starts.
    const live = records.find((r) => r.status === "submitting")!;
    live.status = "submitted";
    live.medicaid_trips.robot_job_id = null;
    const third = await dispatchLeasedSubmissions(supabase, "actor");
    expect(third.started).toBe(1);
    expect(started.length).toBe(2);
  });

  it("keeps parallel dispatchers to one live session in total", async () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    const batches = await Promise.all([
      dispatchLeasedSubmissions(supabase, "a", { worker: "a" }),
      dispatchLeasedSubmissions(supabase, "b", { worker: "b" }),
      dispatchLeasedSubmissions(supabase, "c", { worker: "c" }),
    ]);
    const ids = batches.flatMap((b) => b.startedIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(1);
  });

  it("still runs different provider accounts in parallel", async () => {
    const records = [
      makeRecord("1", { company: "co-a", riderId: "ra" }),
      makeRecord("2", { company: "co-b", riderId: "rb" }),
      makeRecord("3", { company: "co-c", riderId: "rc" }),
    ];
    const { supabase } = makeFakeDb(records);
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.started).toBe(3);
    expect(new Set(res.startedIds).size).toBe(3);
  });
});

describe("idempotency: double clicks, refreshes and extra tabs", () => {
  it("collapses concurrent clicks on one bill into a single job", async () => {
    const rec = makeRecord("1", { riderId: "rA", status: "approved" });
    const { supabase } = makeFakeDb([rec]);
    const trip = rec.medicaid_trips;

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        enqueueOrStartRobot(supabase, {
          billingRecordId: "1",
          companyId: "co1",
          trip,
          providerUserId: "biller",
          mode: "full",
        }),
      ),
    );
    expect(started.length).toBe(1);
    expect(results.filter((r) => !r.queued).length).toBe(1);
    expect(results.filter((r) => r.duplicate).length).toBe(3);
  });

  it("reports a second click on an in-flight bill as queued, never a new job", async () => {
    const rec = makeRecord("1", { riderId: "rA", status: "submitting", jobId: "j1" });
    const { supabase } = makeFakeDb([rec]);
    const out = await enqueueOrStartRobot(supabase, {
      billingRecordId: "1",
      companyId: "co1",
      trip: rec.medicaid_trips,
      providerUserId: "biller",
      mode: "full",
    });
    expect(out).toMatchObject({ queued: true, duplicate: true });
    expect(started.length).toBe(0);
  });

  it("parks an interactive submit behind a live session instead of starting it", async () => {
    const live = makeRecord("1", { riderId: "rA", status: "submitting", jobId: "j1" });
    const next = makeRecord("2", { riderId: "rB", status: "approved" });
    const { supabase } = makeFakeDb([live, next]);
    const out = await enqueueOrStartRobot(supabase, {
      billingRecordId: "2",
      companyId: "co1",
      trip: next.medicaid_trips,
      providerUserId: "biller",
      mode: "full",
    });
    expect(out.queued).toBe(true);
    expect(next.status).toBe("queued");
    expect(started.length).toBe(0);
  });
});

describe("ambiguous outcomes are never auto-resubmitted", () => {
  it("detects portal claim evidence in our own records", () => {
    expect(hasPortalClaimEvidence({ medicaid_trips: { robot_confirmation_number: "123" } })).toBe(
      true,
    );
    expect(hasPortalClaimEvidence({ medicaid_trips: { robot_last_status: "SUBMITTED_UNVERIFIED" } })).toBe(
      true,
    );
    expect(hasPortalClaimEvidence({ state_confirmation_number: "999", medicaid_trips: {} })).toBe(true);
    expect(hasPortalClaimEvidence({ medicaid_trips: { robot_last_status: "FAILED" } })).toBe(false);
  });

  it("routes a retry with claim evidence to awaiting verification", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    rec.submit_attempt_count = 1;
    rec.submit_last_error = "Robot timed out after 480s";
    rec.medicaid_trips.robot_confirmation_number = "9426213001270";
    const { supabase } = makeFakeDb([rec]);

    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.started).toBe(0);
    expect(res.blocked).toBe(1);
    expect(started.length).toBe(0);
    expect(rec.status).toBe("needs_fix");
    expect(rec.requires_human_step).toBe(true);
  });

  it("retries a timeout only when there is no claim evidence at all", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    rec.submit_attempt_count = 1;
    rec.submit_last_error = "Robot timed out after 480s";
    const { supabase } = makeFakeDb([rec]);
    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.blocked).toBe(0);
    expect(res.started).toBe(1);
  });

  it("stops for a human when the confirm step outcome is unknown", async () => {
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

  it("stops for a human on portal Step 1 required-field failures", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    const out = await scheduleRetryOrFail(supabase, {
      id: "1",
      tripId: "t1",
      attempt: 0,
      error: "Still on Step 1 after clicking Continue. Errors: * Indicates a required field.",
      actorId: null,
    });
    expect(out).toBe("failed");
    expect(rec.requires_human_step).toBe(true);
    expect(rec.submission_error).toBe(PORTAL_STEP1_USER_MESSAGE);
  });
});

describe("worker/browser failures release the lock cleanly", () => {
  it("classifies Chromium and navigation failures as infrastructure", () => {
    for (const msg of [
      "browserType.launch: spawn ETXTBSY",
      "Error: spawn EAGAIN",
      "page.goto: Timeout 30000ms exceeded",
      "Target page, context or browser has been closed",
      "net::ERR_CONNECTION_RESET",
    ]) {
      expect(isInfrastructureSubmitError(msg)).toBe(true);
      expect(isTransientSubmitError(msg)).toBe(true);
      expect(sanitizeSubmitError(msg)).toBe(INFRA_USER_MESSAGE);
    }
    expect(isInfrastructureSubmitError("Member ID is invalid")).toBe(false);
  });

  it("hides stack traces from the biller but keeps diagnostics in the record", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec]);
    failNext =
      "browserType.launch: spawn EAGAIN\n    at ChromiumBrowser.launch (/app/node_modules/playwright-core/index.js:12:9)";

    const res = await dispatchLeasedSubmissions(supabase, "actor");
    expect(res.started).toBe(0);
    expect(res.retried).toBe(1);
    expect(rec.status).toBe("queued");
    expect(rec.submission_error).toBe(INFRA_USER_MESSAGE);
    expect(String(rec.submit_last_error)).toContain("spawn EAGAIN");
    // Lock released, and the next attempt waits out a cooldown.
    expect(rec.submit_locked_until).toBeNull();
    const wait = new Date(rec.submit_next_attempt_at!).getTime() - Date.now();
    expect(wait).toBeGreaterThan(submitInfraCooldownMs() - 5_000);
  });

  it("lets the next SAFE queued job proceed after the failure", async () => {
    const bad = makeRecord("1", { riderId: "rA" });
    const good = makeRecord("2", { riderId: "rB" });
    const { supabase } = makeFakeDb([bad, good]);

    failNext = "Target page, context or browser has been closed";
    const first = await dispatchLeasedSubmissions(supabase, "actor");
    expect(first.started).toBe(0);

    const second = await dispatchLeasedSubmissions(supabase, "actor");
    expect(second.startedIds).toEqual(["2"]);
    expect(started.length).toBe(1);
  });
});

describe("queue recovery", () => {
  it("releases abandoned leases and resumes the single-flight queue", async () => {
    const rec = makeRecord("1", {
      riderId: "rA",
      submit_locked_until: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const { supabase } = makeFakeDb([rec]);
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.staleLocksReleased).toBe(1);
    expect(tick.started).toBe(1);
  });

  it("never resubmits an orphaned in-flight bill", async () => {
    const rec = makeRecord("1", {
      riderId: "rA",
      status: "submitting",
      updated_at: "2020-01-01T00:00:00.000Z",
    });
    const { supabase } = makeFakeDb([rec]);
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.recovered).toBe(1);
    expect(rec.status).toBe("needs_fix");
    expect(rec.requires_human_step).toBe(true);
    expect(started.length).toBe(0);
  });

  it("dispatches nothing at all while the queue is paused", async () => {
    const rec = makeRecord("1", { riderId: "rA" });
    const { supabase } = makeFakeDb([rec], { paused: true, pause_reason: "Worker maintenance" });
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.ran).toBe(false);
    expect(started.length).toBe(0);
    expect(rec.status).toBe("queued");
  });
});
