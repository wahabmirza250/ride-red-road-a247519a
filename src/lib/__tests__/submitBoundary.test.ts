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
import { makeRecord } from "./fakeQueueDb";

/** Minimal DB: one live `submitting` bill for the same company. */
function dbWithLiveJob() {
  const live = makeRecord("live", { riderId: "rOther", status: "submitting", jobId: "job-live" });
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
      then: (res: any, rej?: any) => Promise.resolve({ data: [live], error: null }).then(res, rej),
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as any;
}

beforeEach(() => {
  dispatched.length = 0;
});

describe("startRobotSubmission single-flight boundary", () => {
  it("refuses a real submit while another session is live on the account", async () => {
    const supabase = dbWithLiveJob();
    await expect(
      startRobotSubmission(supabase, {
        billingRecordId: "bypass",
        trip: { id: "t1", company_id: "co1", riders: { medicaid_id: "A123456" } },
        providerUserId: "biller",
        mode: "full",
      }),
    ).rejects.toThrow(/already running on this provider account/i);
    expect(dispatched.length).toBe(0);
  });

  it("still refuses the legacy two-pass confirm submit", async () => {
    const supabase = dbWithLiveJob();
    await expect(
      startRobotSubmission(supabase, {
        billingRecordId: "bypass",
        trip: { id: "t1", company_id: "co1", riders: { medicaid_id: "A123456" } },
        providerUserId: "biller",
        mode: "submit",
      }),
    ).rejects.toThrow(/temporarily unavailable/i);
    expect(dispatched.length).toBe(0);
  });
});
