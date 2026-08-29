/**
 * SCHEDULER FAIRNESS: a same-rider run at the head of the queue must not starve
 * the account's safe worker capacity. Nothing here touches the live automation
 * service — `startRobotSubmission` is mocked and any real fetch throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const started: any[] = [];

vi.mock("@/lib/billingHelpers", () => ({
  startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
    started.push(args);
    args.trip.robot_job_id = `job-${args.billingRecordId}`;
    args.trip.robot_job_started_at = new Date().toISOString();
  }),
  logAudit: vi.fn(async () => {}),
  looksLikeRetryableTimeout: () => false,
  hasExplicitPreSubmitFailureEvidence: () => false,
  looksLikePossiblySubmittedTimeout: () => false,
}));

import { makeFakeDb, makeRecord } from "./fakeQueueDb";
import { dispatchLeasedSubmissions, maxSubmitPerCompany } from "@/lib/submissionQueue.server";
import { AUTO_PILOT_WAVE, nextFeedSize } from "@/lib/autoPilot";

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  started.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("NETWORK CALL ATTEMPTED IN TEST MODE");
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const riderOf = (rec: any) => rec.medicaid_trips.rider_id as string;

describe("lease fairness across riders", () => {
  it("fills every safe slot with DIFFERENT riders when the oldest rows share one rider", async () => {
    const records = [
      // Four oldest bills all belong to the same passenger.
      ...Array.from({ length: 4 }, (_, i) => makeRecord(`1${i}`, { riderId: "same" })),
      // Later bills belong to distinct passengers.
      ...Array.from({ length: 6 }, (_, i) => makeRecord(`2${i}`, { riderId: `other-${i}` })),
    ];
    const { supabase } = makeFakeDb(records);

    const res = await dispatchLeasedSubmissions(supabase, null, { worker: "w" });

    expect(res.started).toBe(maxSubmitPerCompany());
    const live = records.filter((r) => r.status === "submitting");
    expect(live.length).toBe(4);
    // Distinct riders, exactly one from the same-rider run.
    const riders = live.map(riderOf);
    expect(new Set(riders).size).toBe(4);
    expect(riders.filter((r) => r === "same").length).toBe(1);
    // The blocked same-rider rows are untouched and still queued.
    expect(records.filter((r) => riderOf(r) === "same" && r.status === "queued").length).toBe(3);
    expect(
      records
        .filter((r) => riderOf(r) === "same" && r.status === "queued")
        .every((r) => (r.submit_attempt_count ?? 0) === 0),
    ).toBe(true);
  });

  it("still allows at most one live claim per rider", async () => {
    const records = Array.from({ length: 8 }, (_, i) => makeRecord(String(i + 1), { riderId: "solo" }));
    const { supabase } = makeFakeDb(records);
    await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    expect(records.filter((r) => r.status === "submitting").length).toBe(1);
  });

  it("never exceeds 4 active submissions on one account across a multi-worker fleet", async () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records, undefined, [
      { id: "worker-1", base_url: "http://w1", max_active_jobs: 4 },
      { id: "worker-2", base_url: "http://w2", max_active_jobs: 4 },
    ]);

    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        dispatchLeasedSubmissions(supabase, null, { worker: `w${i}` }),
      ),
    );
    expect(records.filter((r) => r.status === "submitting").length).toBeLessThanOrEqual(4);
  });

  it("refills freed slots with the next distinct riders in the same wave", async () => {
    const records = Array.from({ length: 12 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    const firstBatch = records.filter((r) => r.status === "submitting").map((r) => r.id);
    expect(firstBatch.length).toBe(4);

    // Two claims reach a terminal outcome — their slots must be reused at once.
    for (const id of firstBatch.slice(0, 2)) {
      const rec = records.find((r) => r.id === id)!;
      rec.status = "submitted";
      rec.medicaid_trips.robot_job_id = null;
    }
    await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    const live = records.filter((r) => r.status === "submitting");
    expect(live.length).toBe(4);
    expect(new Set(live.map(riderOf)).size).toBe(4);
  });
});

describe("Auto Pilot wave sizing is unchanged", () => {
  it("stays at 20 per wave and takes the whole tail when fewer remain", () => {
    expect(AUTO_PILOT_WAVE).toBe(20);
    expect(nextFeedSize(100, 0)).toBe(20);
    expect(nextFeedSize(7, 0)).toBe(7);
  });
});
