/**
 * FINAL SINGLE-FLIGHT BOUNDARY inside `startRobotSubmission`.
 *
 * Even if a future code path bypassed the DB-leased queue, the shared helper
 * must refuse to open a second live portal session for one provider account.
 * No network call happens here: the fleet dispatcher is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dispatched: any[] = [];

vi.mock("@/lib/robotFleet.server", () => ({
  dispatchToFleet: vi.fn(async (_sb: any, args: any) => {
    dispatched.push(args);
    return { jobId: args.jobId, workerId: "w1", workerUrl: "http://mock", failedOverFrom: null };
  }),
  loadFleetContext: vi.fn(async () => ({ fleet: [], load: new Map() })),
}));

import { startRobotSubmission } from "@/lib/billingHelpers";
import { MAX_CONCURRENT_ROBOT_JOBS } from "@/lib/robotQueue.server";
import { makeRecord } from "./fakeQueueDb";

/** Minimal DB serving a fixed set of live `submitting` bills. */
function dbWithLiveJobs(live: any[]) {
  const from = () => {
    const builder: any = {
      select: () => builder,
      update: () => builder,
      eq: () => builder,
      in: () => builder,
      lt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej?: any) => Promise.resolve({ data: live, error: null }).then(res, rej),
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as any;
}

const liveFor = (id: string, riderId: string) =>
  makeRecord(id, { riderId, status: "submitting", jobId: `job-${id}` });

beforeEach(() => {
  dispatched.length = 0;
});

describe("startRobotSubmission concurrency boundary", () => {
  it("refuses a real submit once the account is at its concurrency cap", async () => {
    const supabase = dbWithLiveJobs(
      Array.from({ length: MAX_CONCURRENT_ROBOT_JOBS }, (_, i) => liveFor(`L${i}`, `rOther${i}`)),
    );
    await expect(
      startRobotSubmission(supabase, {
        billingRecordId: "bypass",
        trip: { id: "t1", company_id: "co1", rider_id: "rMine", riders: { medicaid_id: "A123456" } },
        providerUserId: "biller",
        mode: "full",
      }),
    ).rejects.toThrow(/already running on this provider account/i);
    expect(dispatched.length).toBe(0);
  });

  it("refuses a second live session for the SAME passenger", async () => {
    const supabase = dbWithLiveJobs([liveFor("L0", "rMine")]);
    await expect(
      startRobotSubmission(supabase, {
        billingRecordId: "bypass",
        trip: { id: "t1", company_id: "co1", rider_id: "rMine", riders: { medicaid_id: "A123456" } },
        providerUserId: "biller",
        mode: "submit",
      }),
    ).rejects.toThrow(/temporarily unavailable/i);
    expect(dispatched.length).toBe(0);
  });

  it("does NOT block a different passenger while the account has free slots", async () => {
    const supabase = dbWithLiveJobs([liveFor("L0", "rOther")]);
    // It gets past the concurrency gate and fails later on missing trip data.
    await expect(
      startRobotSubmission(supabase, {
        billingRecordId: "bypass",
        trip: { id: "t1", company_id: "co1", rider_id: "rMine", riders: { medicaid_id: "A123456" } },
        providerUserId: "biller",
        mode: "full",
      }),
    ).rejects.not.toThrow(/already running on this provider account/i);
    expect(dispatched.length).toBe(0);
  });
});

