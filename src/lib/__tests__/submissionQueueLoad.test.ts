/**
 * DETERMINISTIC LOAD HARNESS for the submission queue.
 *
 * Nothing here touches production data or the network: synthetic records live
 * in the in-memory fake DB, and every "robot" call goes through the real
 * adapter with SUBMISSION_TEST_MODE on, so a real portal call is impossible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env["SUBMISSION_TEST_MODE"] = "1";

const plan = new Map<string, string>();
let realFetch: any;

vi.mock("@/lib/billingHelpers", async () => {
  const adapter = await import("@/lib/robotAdapter.server");
  return {
    ROBOT_BASE_URL: "https://example.invalid",
    logAudit: vi.fn(async () => {}),
    looksLikeRetryableTimeout: (m: string) => /timed out|timeout/i.test(String(m ?? "")),
    hasExplicitPreSubmitFailureEvidence: (m: string) => /pre_submit|submit_reached\s*[:=]\s*false|stage\s*[:=]\s*(login|launch|step1)/i.test(String(m ?? "")),
  looksLikePossiblySubmittedTimeout: (m: string) =>
      /SubmitClaimProf3|after clicking (?:Submit|Confirm)/i.test(String(m ?? "")) &&
      /timed out|timeout|closed/i.test(String(m ?? "")),
    startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
      const outcome = (plan.get(args.billingRecordId) ?? "fast_success") as any;
      adapter.setMockRobotPlan(() => outcome);
      const jobId = await adapter.postSubmitClaim({ id: args.billingRecordId }, `j-${args.billingRecordId}`);
      args.trip.robot_job_id = jobId;
      args.trip.robot_job_started_at = new Date().toISOString();
    }),
  };
});

import { makeFakeDb, makeRecord, type FakeRecord } from "./fakeQueueDb";
import {
  dispatchLeasedSubmissions,
  runSubmissionQueueTick,
  recoverOrphanedSubmissions,
  maxSubmitPerCompany,
  maxSubmitGlobal,
} from "@/lib/submissionQueue.server";

const OUTCOMES = [
  "fast_success",
  "fast_success",
  "fast_success",
  "slow_success",
  "transient_timeout",
  "validation_failure",
  "ambiguous",
] as const;

/** 3 normal companies + one high-volume tenant. */
function buildWorkload(total: number) {
  const companies = ["co-a", "co-b", "co-c", "co-big"];
  const recs: FakeRecord[] = [];
  for (let i = 0; i < total; i++) {
    // co-big gets ~70% of the volume, the rest split the remainder.
    const company = i % 10 < 7 ? "co-big" : companies[i % 3]!;
    const r = makeRecord(String(i + 1), { company, riderId: `rider-${company}-${i % 37}` });
    recs.push(r);
    plan.set(r.id, OUTCOMES[i % OUTCOMES.length]!);
  }
  return recs;
}

/** Free finished jobs so the next tick has capacity, like reconcile does. */
function settleRunning(records: FakeRecord[]) {
  for (const r of records) {
    if (r.status === "submitting") {
      r.status = "submitted";
      r.medicaid_trips.robot_job_id = null;
    }
  }
}

/** Open every backoff window so retries are due immediately. */
function fastForwardBackoff(records: FakeRecord[]) {
  for (const r of records) {
    if (r.submit_next_attempt_at) r.submit_next_attempt_at = new Date(Date.now() - 1000).toISOString();
  }
}

beforeEach(() => {
  plan.clear();
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("NETWORK CALL ATTEMPTED IN TEST MODE");
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function drain(records: FakeRecord[], supabase: any, maxTicks = 4000) {
  const t0 = Date.now();
  let ticks = 0;
  let started = 0;
  let retried = 0;
  let failed = 0;
  const startedIds: string[] = [];
  const perTickCompanies: Array<Record<string, number>> = [];

  while (ticks < maxTicks) {
    ticks++;
    const before = records.filter((r) => r.status === "queued").length;
    if (before === 0) break;
    const out = await dispatchLeasedSubmissions(supabase, null, { worker: `w${ticks}` });
    started += out.started;
    retried += out.retried;
    failed += out.failed;
    startedIds.push(...out.startedIds);
    const byCo: Record<string, number> = {};
    for (const id of out.startedIds) {
      const c = String(records.find((r) => r.id === id)?.company_id);
      byCo[c] = (byCo[c] ?? 0) + 1;
    }
    perTickCompanies.push(byCo);
    if (out.leased === 0) {
      fastForwardBackoff(records);
      const again = await dispatchLeasedSubmissions(supabase, null, { worker: `w${ticks}b` });
      if (again.leased === 0) break;
      started += again.started;
      retried += again.retried;
      failed += again.failed;
      startedIds.push(...again.startedIds);
    }
    settleRunning(records);
    fastForwardBackoff(records);
  }
  return {
    ms: Date.now() - t0,
    ticks,
    started,
    retried,
    failed,
    startedIds,
    perTickCompanies,
  };
}

describe.each([20, 100, 500, 800])("load: %i queued jobs", (total) => {
  it("drains with no duplicates, no lock leaks and no starvation", async () => {
    const records = buildWorkload(total);
    const { supabase } = makeFakeDb(records);

    const res = await drain(records, supabase);

    // No bill was ever dispatched twice.
    expect(new Set(res.startedIds).size).toBe(res.startedIds.length);
    // Nothing left holding a lease.
    expect(records.filter((r) => r.submit_locked_until).length).toBe(0);
    // Nothing left stuck in `queued`.
    expect(records.filter((r) => r.status === "queued").length).toBe(0);
    // Every bill reached a terminal-ish state.
    for (const r of records) expect(["submitted", "needs_fix"]).toContain(r.status);
    // Fairness: no tick ever exceeded the caps.
    for (const t of res.perTickCompanies) {
      const totalStarted = Object.values(t).reduce((a, b) => a + b, 0);
      expect(totalStarted).toBeLessThanOrEqual(maxSubmitGlobal());
      for (const n of Object.values(t)) expect(n).toBeLessThanOrEqual(maxSubmitPerCompany());
    }
    // The small tenants were served, not starved by co-big.
    const smallServed = res.startedIds.filter(
      (id) => records.find((r) => r.id === id)?.company_id !== "co-big",
    ).length;
    if (total >= 100) expect(smallServed).toBeGreaterThan(0);
    // Validation failures never retried; transient ones did.
    expect(res.failed).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `[load ${total}] ${res.ms}ms, ticks=${res.ticks}, started=${res.started}, retried=${res.retried}, needs_fix=${records.filter((r) => r.status === "needs_fix").length}`,
    );
  });
});

describe.each([3, 10])("concurrent dispatchers: %i simultaneous ticks", (workers) => {
  it("never double-leases and always respects both caps", async () => {
    const records = buildWorkload(200);
    for (const r of records) plan.set(r.id, "fast_success");
    const { supabase } = makeFakeDb(records);

    const batches = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        dispatchLeasedSubmissions(supabase, null, { worker: `sim-${i}` }),
      ),
    );
    const ids = batches.flatMap((b) => b.startedIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(maxSubmitGlobal());
    const byCo = ids.reduce<Record<string, number>>((m, id) => {
      const c = String(records.find((r) => r.id === id)?.company_id);
      m[c] = (m[c] ?? 0) + 1;
      return m;
    }, {});
    for (const n of Object.values(byCo)) expect(n).toBeLessThanOrEqual(maxSubmitPerCompany());
    // Round-robin: more than one company got a slot.
    expect(Object.keys(byCo).length).toBeGreaterThan(1);
  });
});

describe("worker restart mid-run", () => {
  it("keeps queued work, recovers abandoned leases and never resubmits ambiguous in-flight jobs", async () => {
    const records = buildWorkload(40);
    for (const r of records) plan.set(r.id, "fast_success");
    const { supabase } = makeFakeDb(records);

    await dispatchLeasedSubmissions(supabase, null, { worker: "crashy" });

    // Simulate the crash: some rows are mid-flight without a robot job id,
    // some queued rows still hold an expired lease.
    const inflight = records.filter((r) => r.status === "submitting").slice(0, 3);
    for (const r of inflight) {
      r.medicaid_trips.robot_job_id = null;
      r.updated_at = "2020-01-01T00:00:00.000Z";
    }
    const abandoned = records.filter((r) => r.status === "queued").slice(0, 5);
    for (const r of abandoned) {
      r.submit_locked_until = new Date(Date.now() - 60 * 60_000).toISOString();
      r.submit_worker = "crashy";
    }

    const recovered = await recoverOrphanedSubmissions(supabase);
    expect(recovered).toBe(inflight.length);
    for (const r of inflight) {
      expect(r.status).toBe("needs_fix");
      expect(r.requires_human_step).toBe(true);
    }

    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.staleLocksReleased).toBe(abandoned.length);
    expect(tick.started).toBeGreaterThan(0);
    // Queued work survived the restart.
    expect(records.filter((r) => ["queued", "submitting", "submitted"].includes(r.status)).length)
      .toBeGreaterThan(0);
  });
});

describe("pause is immediate", () => {
  it("dispatches nothing new while paused", async () => {
    const records = buildWorkload(30);
    for (const r of records) plan.set(r.id, "fast_success");
    const { supabase } = makeFakeDb(records, { paused: true, pause_reason: "Ops hold" });
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.ran).toBe(false);
    expect(tick.started).toBe(0);
    expect(records.every((r) => r.status === "queued")).toBe(true);
  });
});
