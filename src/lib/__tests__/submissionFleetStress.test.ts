/**
 * FLEET STRESS HARNESS — 100 companies, 30k–40k queued bills.
 *
 * Entirely synthetic: in-memory fake DB, mocked robot workers, and
 * `SUBMISSION_TEST_MODE` so the adapter physically cannot reach a network.
 * What is measured here is QUEUE BOOKKEEPING (lease → route → dispatch), NOT
 * HCPF portal speed: a real portal session takes tens of seconds regardless of
 * how fast this layer is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env["SUBMISSION_TEST_MODE"] = "1";
process.env["ROBOT_BASE_URLS"] = Array.from(
  { length: 10 },
  (_, i) => `w${i + 1}=https://w${i + 1}.test`,
).join(",");

const downWorkers = new Set<string>();
const routed: Array<{ company: string; worker: string; id: string }> = [];

vi.mock("@/lib/billingHelpers", async () => {
  const fleet = await import("@/lib/robotFleet.server");
  return {
    ROBOT_BASE_URL: "https://legacy.test",
    logAudit: vi.fn(async () => {}),
    looksLikeRetryableTimeout: (m: string) => /timed out|timeout/i.test(String(m ?? "")),
    startRobotSubmission: vi.fn(async (sb: any, args: any) => {
      const out = await fleet.dispatchToFleet(sb, {
        payload: { company_id: args.companyId, billing_record_id: args.billingRecordId },
        jobId: `j-${args.billingRecordId}`,
        companyId: args.companyId,
        context: args.fleetContext ?? null,
      });
      routed.push({ company: String(args.companyId), worker: out.workerId, id: args.billingRecordId });
      args.trip.robot_job_id = out.jobId;
      args.trip.robot_worker_id = out.workerId;
      args.trip.robot_worker_url = out.workerUrl;
      args.trip.robot_job_started_at = new Date().toISOString();
    }),
  };
});

import { setMockRobotPlan } from "@/lib/robotAdapter.server";
import { makeFakeDb, makeRecord, type FakeRecord, type FakeWorker } from "./fakeQueueDb";
import { dispatchLeasedSubmissions, maxSubmitPerCompany } from "@/lib/submissionQueue.server";
import {
  loadFleet,
  effectiveGlobalLimit,
  healthyWorkers,
  parseFleetEnv,
  pickWorkerForCompany,
} from "@/lib/robotFleet.server";

const COMPANIES = 100;

function fleetRows(count = 10, maxActive = 20): FakeWorker[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i + 1}`,
    base_url: `https://w${i + 1}.test`,
    enabled: true,
    max_active_jobs: maxActive,
  }));
}

/** 100 tenants x `per` bills each. */
function buildWorkload(per: number): FakeRecord[] {
  const recs: FakeRecord[] = [];
  let n = 0;
  for (let c = 0; c < COMPANIES; c++) {
    for (let i = 0; i < per; i++) {
      n++;
      recs.push(
        makeRecord(String(n), { company: `co-${c}`, riderId: `rider-${c}-${i}` }),
      );
    }
  }
  return recs;
}

function settle(records: FakeRecord[]) {
  for (const r of records) {
    if (r.status === "submitting") {
      r.status = "submitted";
      r.medicaid_trips.robot_job_id = null;
    }
  }
}

let realFetch: any;
beforeEach(() => {
  routed.length = 0;
  downWorkers.clear();
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("NETWORK CALL ATTEMPTED IN TEST MODE");
  }) as any;
  setMockRobotPlan((_job, payload: any) =>
    downWorkers.has(payload.__worker) ? "worker_down" : "fast_success",
  );
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe.each([300, 400])("100 companies x %i bills (routing model)", (per) => {
  it("routes 30k-40k bills with no starvation, no cross-tenant mix and stable affinity", () => {
    // Bookkeeping model at full scale: leasing + worker routing only, which is
    // what the app owns. Actual portal time is the robot's, not this layer's.
    const records = buildWorkload(per);
    const total = records.length;
    const fleet = parseFleetEnv();
    expect(fleet).toHaveLength(10);

    const t0 = Date.now();
    const load = new Map<string, number>();
    const perCompany = new Map<string, number>();
    const workersPerCompany = new Map<string, Set<string>>();
    for (const r of records) {
      const co = String(r.company_id);
      const w = pickWorkerForCompany(fleet, co, load)!;
      expect(w).toBeTruthy();
      perCompany.set(co, (perCompany.get(co) ?? 0) + 1);
      const s = workersPerCompany.get(co) ?? new Set<string>();
      s.add(w.id);
      workersPerCompany.set(co, s);
    }
    const ms = Date.now() - t0;

    expect(total).toBeGreaterThanOrEqual(30_000);
    expect(perCompany.size).toBe(COMPANIES);
    for (const n of perCompany.values()) expect(n).toBe(per);
    for (const s of workersPerCompany.values()) expect(s.size).toBe(1);
    expect(new Set([...workersPerCompany.values()].flatMap((s) => [...s])).size).toBe(10);

    // eslint-disable-next-line no-console
    console.log(
      `[fleet model] ${total} bills / ${COMPANIES} companies routed in ${ms}ms ` +
        `(~${Math.round(total / Math.max(ms, 1) * 1000)} routing decisions/sec — queue speed, NOT portal speed)`,
    );
  }, 120_000);
});

describe("live mocked dispatch batch", () => {
  it("drains 100 companies x 20 bills through the real dispatch path", async () => {
    const records = buildWorkload(20);
    const total = records.length;
    const { supabase } = makeFakeDb(records, undefined, fleetRows());

    const t0 = Date.now();
    let ticks = 0;
    const started: string[] = [];
    while (records.some((r) => r.status === "queued") && ticks < 400) {
      ticks++;
      const out = await dispatchLeasedSubmissions(supabase, null, { worker: `w${ticks}` });
      if (out.leased === 0) break;
      started.push(...out.startedIds);
      settle(records);
    }
    const ms = Date.now() - t0;

    expect(new Set(started).size).toBe(started.length);
    expect(started.length).toBe(total);
    expect(records.filter((r) => r.status === "queued")).toHaveLength(0);
    expect(records.filter((r) => r.submit_locked_until)).toHaveLength(0);

    const byId = new Map(records.map((r) => [r.id, r.company_id]));
    for (const r of routed) expect(r.company).toBe(byId.get(r.id));
    // Affinity is "home worker first, spill only when that worker is full".
    // Across a multi-tick drain a busy tenant may legitimately overflow onto a
    // neighbour, so assert dominance (never scatter) rather than a hard 1.
    const workersPerCompany = new Map<string, Map<string, number>>();
    for (const r of routed) {
      const m = workersPerCompany.get(r.company) ?? new Map<string, number>();
      m.set(r.worker, (m.get(r.worker) ?? 0) + 1);
      workersPerCompany.set(r.company, m);
    }
    expect(workersPerCompany.size).toBe(COMPANIES);
    for (const m of workersPerCompany.values()) {
      const counts = [...m.values()].sort((a, b) => b - a);
      const totalForCo = counts.reduce((a, b) => a + b, 0);
      expect(m.size).toBeLessThanOrEqual(2);
      expect(counts[0]! / totalForCo).toBeGreaterThanOrEqual(0.5);
    }
    expect(new Set(routed.map((r) => r.worker)).size).toBe(10);

    // eslint-disable-next-line no-console
    console.log(
      `[fleet dispatch] ${total} bills dispatched against 10 mocked workers in ${ms}ms, ${ticks} ticks`,
    );
  }, 300_000);
});

describe("mid-day worker loss: 10 -> 9 -> 7 healthy", () => {
  it("rebalances queued work while accepted jobs stay pinned to their worker", async () => {
    const records = buildWorkload(20);
    const workers = fleetRows();
    const { supabase, robotWorkers } = makeFakeDb(records, undefined, workers);

    // Phase 1 — full fleet.
    const first = await dispatchLeasedSubmissions(supabase, null, { worker: "p1" });
    expect(first.started).toBeGreaterThan(0);
    const pinned = records
      .filter((r) => r.medicaid_trips.robot_worker_id)
      .map((r) => ({ id: r.id, worker: r.medicaid_trips.robot_worker_id as string }));
    expect(pinned.length).toBe(first.started);
    settle(records);

    // Phase 2 — one worker switched off by ops.
    robotWorkers.find((w) => w.id === "w1")!.enabled = false;
    let fleet = await loadFleet(supabase);
    expect(healthyWorkers(fleet)).toHaveLength(9);
    expect(effectiveGlobalLimit(fleet, 20)).toBe(180);
    routed.length = 0;
    await dispatchLeasedSubmissions(supabase, null, { worker: "p2" });
    expect(routed.some((r) => r.worker === "w1")).toBe(false);
    settle(records);

    // Phase 3 — two more crash (health probe cools them down).
    for (const id of ["w2", "w3"]) {
      const w = robotWorkers.find((x) => x.id === id)!;
      w.unhealthy_until = new Date(Date.now() + 10 * 60_000).toISOString();
    }
    fleet = await loadFleet(supabase);
    expect(healthyWorkers(fleet)).toHaveLength(7);
    expect(effectiveGlobalLimit(fleet, 20)).toBe(140);
    routed.length = 0;
    const third = await dispatchLeasedSubmissions(supabase, null, { worker: "p3" });
    expect(third.started).toBeGreaterThan(0);
    expect(routed.some((r) => ["w1", "w2", "w3"].includes(r.worker))).toBe(false);

    // Jobs accepted in phase 1 are still pinned to the worker that took them.
    for (const p of pinned) {
      expect(records.find((r) => r.id === p.id)!.medicaid_trips.robot_worker_id).toBe(p.worker);
    }
  }, 120_000);

  it("keeps the per-company cap even when the fleet is huge", async () => {
    const records = buildWorkload(50);
    const { supabase } = makeFakeDb(records, undefined, fleetRows(10, 40));
    const out = await dispatchLeasedSubmissions(supabase, null, { worker: "cap" });
    const perCompany = new Map<string, number>();
    for (const id of out.startedIds) {
      const co = String(records.find((r) => r.id === id)!.company_id);
      perCompany.set(co, (perCompany.get(co) ?? 0) + 1);
    }
    for (const n of perCompany.values()) expect(n).toBeLessThanOrEqual(maxSubmitPerCompany());
    // Many tenants progressed at once — no single company owned the fleet.
    expect(perCompany.size).toBeGreaterThan(10);
  }, 120_000);

  it("dispatches nothing when the whole fleet is disabled", async () => {
    const records = buildWorkload(2);
    const { supabase } = makeFakeDb(
      records,
      undefined,
      fleetRows().map((w) => ({ ...w, enabled: false })),
    );
    const out = await dispatchLeasedSubmissions(supabase, null, { worker: "off" });
    expect(out.started).toBe(0);
    expect(out.leased).toBe(0);
    expect(records.every((r) => r.status === "queued")).toBe(true);
  }, 60_000);
});
