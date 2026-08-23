/**
 * ROBOT FLEET tests — routing/bookkeeping only.
 * No network: `SUBMISSION_TEST_MODE` makes the adapter answer in-process, and
 * `fetch` is replaced with a throwing stub for the whole file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env["SUBMISSION_TEST_MODE"] = "1";

import {
  parseFleetEnv,
  mergeFleet,
  hashString,
  pickWorkerForCompany,
  healthyWorkers,
  fleetCapacity,
  effectiveGlobalLimit,
  classifyDispatchFailure,
  dispatchToFleet,
  pollBaseUrlFor,
  type FleetWorker,
} from "@/lib/robotFleet.server";
import { setMockRobotPlan } from "@/lib/robotAdapter.server";
import { makeFakeDb, makeRecord } from "./fakeQueueDb";

function worker(id: string, over: Partial<FleetWorker> = {}): FleetWorker {
  return {
    id,
    url: `https://${id}.example.invalid`,
    enabled: true,
    max_active_jobs: 20,
    last_health_ok_at: null,
    last_health_error: null,
    failure_streak: 0,
    unhealthy_until: null,
    source: "env",
    ...over,
  };
}

let realFetch: any;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("NETWORK CALL ATTEMPTED IN TEST MODE");
  }) as any;
  setMockRobotPlan(null);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env["ROBOT_FLEET_DISABLED"];
});

describe("fleet configuration", () => {
  it("falls back to the single legacy robot when nothing is configured", () => {
    const fleet = parseFleetEnv("");
    expect(fleet).toHaveLength(1);
    expect(fleet[0]!.url).toMatch(/^https?:\/\//);
  });

  it("parses plain and id=url forms and de-duplicates", () => {
    const fleet = parseFleetEnv("a=https://one.test, https://two.test/, a=https://dup.test");
    expect(fleet.map((w) => w.id)).toEqual(["a", "two.test"]);
    expect(fleet[0]!.url).toBe("https://one.test");
    expect(fleet[1]!.url).toBe("https://two.test");
  });

  it("lets the DB registry override enabled/capacity/health", () => {
    const merged = mergeFleet(parseFleetEnv("a=https://one.test,b=https://two.test"), [
      { id: "a", base_url: "https://one.test", enabled: false, max_active_jobs: 5 },
    ]);
    expect(merged.find((w) => w.id === "a")!.enabled).toBe(false);
    expect(merged.find((w) => w.id === "a")!.max_active_jobs).toBe(5);
    expect(merged.find((w) => w.id === "b")!.enabled).toBe(true);
  });
});

describe("deterministic company affinity", () => {
  const fleet = ["w1", "w2", "w3", "w4"].map((id) => worker(id));

  it("is stable across calls and process-independent", () => {
    for (const co of ["co-a", "co-b", "co-c", "co-zz"]) {
      const first = pickWorkerForCompany(fleet, co)!.id;
      for (let i = 0; i < 25; i++) expect(pickWorkerForCompany(fleet, co)!.id).toBe(first);
      expect(hashString(co)).toBe(hashString(co));
    }
  });

  it("spreads 100 companies over the fleet instead of piling on one worker", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const id = pickWorkerForCompany(fleet, `company-${i}`)!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(4);
    for (const n of counts.values()) expect(n).toBeGreaterThan(5);
  });

  it("moves a company off its home worker only when that worker is unhealthy", () => {
    const home = pickWorkerForCompany(fleet, "co-a")!;
    const degraded = fleet.map((w) =>
      w.id === home.id ? { ...w, unhealthy_until: new Date(Date.now() + 60_000).toISOString() } : w,
    );
    const next = pickWorkerForCompany(degraded, "co-a")!;
    expect(next.id).not.toBe(home.id);
    // ...and comes back home once it recovers.
    expect(pickWorkerForCompany(fleet, "co-a")!.id).toBe(home.id);
  });

  it("skips saturated workers but keeps affinity when there is room", () => {
    const home = pickWorkerForCompany(fleet, "co-a")!;
    const full = new Map([[home.id, home.max_active_jobs]]);
    expect(pickWorkerForCompany(fleet, "co-a", full)!.id).not.toBe(home.id);
    expect(pickWorkerForCompany(fleet, "co-a", new Map([[home.id, 1]]))!.id).toBe(home.id);
  });
});

describe("capacity math", () => {
  it("keeps single-worker behaviour identical to today", () => {
    const one = [worker("solo", { max_active_jobs: 20 })];
    expect(effectiveGlobalLimit(one, 20)).toBe(20);
    // A smaller worker never gets over-subscribed.
    expect(effectiveGlobalLimit([worker("solo", { max_active_jobs: 6 })], 20)).toBe(6);
  });

  it("scales with healthy aggregate capacity for a real fleet", () => {
    const ten = Array.from({ length: 10 }, (_, i) => worker(`w${i}`, { max_active_jobs: 20 }));
    expect(fleetCapacity(ten)).toBe(200);
    expect(effectiveGlobalLimit(ten, 20)).toBe(200);
  });

  it("shrinks when workers are lost and stops entirely when all are down", () => {
    const ten = Array.from({ length: 10 }, (_, i) => worker(`w${i}`));
    const nine = ten.map((w, i) => (i === 0 ? { ...w, enabled: false } : w));
    const seven = nine.map((w, i) =>
      i < 3 ? { ...w, unhealthy_until: new Date(Date.now() + 60_000).toISOString() } : w,
    );
    expect(healthyWorkers(nine)).toHaveLength(9);
    expect(effectiveGlobalLimit(nine, 20)).toBe(180);
    expect(healthyWorkers(seven)).toHaveLength(7);
    expect(effectiveGlobalLimit(seven, 20)).toBe(140);
    const allDown = ten.map((w) => ({ ...w, enabled: false }));
    expect(effectiveGlobalLimit(allDown, 20)).toBe(0);
  });

  it("honours the fleet kill switch without touching status checking", () => {
    process.env["ROBOT_FLEET_DISABLED"] = "1";
    const ten = Array.from({ length: 10 }, (_, i) => worker(`w${i}`));
    expect(healthyWorkers(ten)).toHaveLength(0);
    expect(effectiveGlobalLimit(ten, 20)).toBe(0);
  });
});

describe("failure classification", () => {
  it("treats only provable pre-accept failures as failover-safe", () => {
    expect(classifyDispatchFailure("fetch failed: connect ECONNREFUSED")).toBe("pre_accept");
    expect(classifyDispatchFailure("Automation service rejected the request (503): down")).toBe(
      "pre_accept",
    );
    expect(classifyDispatchFailure("Robot timed out after 600s")).toBe("uncertain");
    expect(classifyDispatchFailure("Confirm was clicked but the page timed out")).toBe("uncertain");
    expect(classifyDispatchFailure("Indicates a required field.")).toBe("uncertain");
  });
});

describe("dispatch, failover and stickiness", () => {
  const env = "w1=https://w1.test,w2=https://w2.test,w3=https://w3.test";

  beforeEach(() => {
    process.env["ROBOT_BASE_URLS"] = env;
  });
  afterEach(() => {
    delete process.env["ROBOT_BASE_URLS"];
  });

  it("records the worker that accepted the job", async () => {
    const { supabase } = makeFakeDb([]);
    setMockRobotPlan(() => "fast_success");
    const out = await dispatchToFleet(supabase, { payload: {}, jobId: "j1", companyId: "co-a" });
    expect(out.workerId).toMatch(/^w[123]$/);
    expect(out.failedOverFrom).toBeNull();
    expect(out.jobId).toBe("mock-j1");
  });

  it("fails over exactly once when the first worker provably refused", async () => {
    const { supabase, robotWorkers } = makeFakeDb([]);
    const seen: string[] = [];
    setMockRobotPlan((_j, payload: any) => {
      seen.push(payload.__worker);
      return seen.length === 1 ? "worker_down" : "fast_success";
    });
    const out = await dispatchToFleet(supabase, { payload: {}, jobId: "j2", companyId: "co-b" });
    expect(seen).toHaveLength(2);
    expect(out.failedOverFrom).toBe(seen[0]);
    expect(out.workerId).toBe(seen[1]);
    // The refusing worker is cooled down in the registry.
    const bad = robotWorkers.find((w) => w.id === seen[0])!;
    expect(bad.failure_streak).toBe(1);
    expect(bad.unhealthy_until).toBeTruthy();
  });

  it("NEVER fails over after an ambiguous/timeout outcome", async () => {
    const { supabase } = makeFakeDb([]);
    const seen: string[] = [];
    setMockRobotPlan((_j, payload: any) => {
      seen.push(payload.__worker);
      return "ambiguous";
    });
    await expect(
      dispatchToFleet(supabase, { payload: {}, jobId: "j3", companyId: "co-c" }),
    ).rejects.toThrow(/timed out/i);
    expect(seen).toHaveLength(1);
  });

  it("dispatches nothing while the kill switch is on", async () => {
    process.env["ROBOT_FLEET_DISABLED"] = "true";
    const { supabase } = makeFakeDb([]);
    setMockRobotPlan(() => "fast_success");
    await expect(
      dispatchToFleet(supabase, { payload: {}, jobId: "j4", companyId: "co-a" }),
    ).rejects.toThrow(/kill switch/i);
  });

  it("refuses to route to a disabled worker", async () => {
    const { supabase } = makeFakeDb([], undefined, [
      { id: "w1", base_url: "https://w1.test", enabled: false },
      { id: "w2", base_url: "https://w2.test", enabled: false },
      { id: "w3", base_url: "https://w3.test", enabled: false },
    ]);
    setMockRobotPlan(() => "fast_success");
    await expect(
      dispatchToFleet(supabase, { payload: {}, jobId: "j5", companyId: "co-a" }),
    ).rejects.toThrow(/No healthy submission robot/i);
  });

  it("always polls the worker that accepted the job", () => {
    expect(pollBaseUrlFor({ robot_worker_url: "https://w2.test/" })).toBe("https://w2.test");
    // Legacy rows with no worker recorded fall back to the original service.
    expect(pollBaseUrlFor({ robot_worker_url: null })).toMatch(/^https?:\/\//);
  });

  it("keeps accepted jobs pinned even after their worker goes unhealthy", async () => {
    const rec = makeRecord("1", { company: "co-a" });
    const { supabase, robotWorkers } = makeFakeDb([rec]);
    setMockRobotPlan(() => "fast_success");
    const out = await dispatchToFleet(supabase, { payload: {}, jobId: "j6", companyId: "co-a" });
    rec.medicaid_trips.robot_worker_id = out.workerId;
    rec.medicaid_trips.robot_worker_url = out.workerUrl;

    robotWorkers.push({
      id: out.workerId,
      base_url: out.workerUrl,
      enabled: false,
      max_active_jobs: 20,
    });
    // Polling target is unchanged — it is read from the row, not from health.
    expect(pollBaseUrlFor(rec.medicaid_trips)).toBe(out.workerUrl);
  });

  it("never mixes companies: each payload goes out exactly as given", async () => {
    const { supabase } = makeFakeDb([]);
    const sent: Array<{ company: string; worker: string }> = [];
    setMockRobotPlan((_j, payload: any) => {
      sent.push({ company: payload.company_id, worker: payload.__worker });
      return "fast_success";
    });
    for (let i = 0; i < 40; i++) {
      const co = `co-${i}`;
      await dispatchToFleet(supabase, {
        payload: { company_id: co },
        jobId: `job-${i}`,
        companyId: co,
      });
    }
    expect(sent).toHaveLength(40);
    sent.forEach((s, i) => expect(s.company).toBe(`co-${i}`));
    // Same company always on the same worker within a run (session stability).
    const again = await dispatchToFleet(supabase, {
      payload: { company_id: "co-7" },
      jobId: "again",
      companyId: "co-7",
    });
    expect(again.workerId).toBe(sent[7]!.worker);
  });
});
