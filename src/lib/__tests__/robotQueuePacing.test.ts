import { describe, it, expect, vi, beforeEach } from "vitest";

const started: any[] = [];
vi.mock("@/lib/billingHelpers", () => ({
  startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
    started.push(args);
    args.trip.robot_job_id = `job-${args.billingRecordId}`;
    args.trip.robot_job_started_at = new Date().toISOString();
  }),
  logAudit: vi.fn(async () => {}),
  looksLikeRetryableTimeout: () => false,
}));

import { makeFakeDb, makeRecord } from "./fakeQueueDb";
import { dispatchNextQueued, MAX_CONCURRENT_JOBS_PER_RIDER } from "@/lib/robotQueue.server";
import { maxSubmitPerCompany } from "@/lib/submissionQueue.server";

describe("per-passenger dispatch pacing", () => {
  beforeEach(() => {
    started.length = 0;
  });

  it("throttles one passenger to the per-rider cap while others run at full speed", async () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) => makeRecord(`${i + 1}`, { riderId: "riderA" })),
      ...["B", "C", "D", "E", "F"].map((r, i) => makeRecord(`${i + 7}`, { riderId: `rider${r}` })),
    ];
    const { supabase } = makeFakeDb(records);

    const res = await dispatchNextQueued(supabase, "actor", "co1");

    // The company cap bounds one pass; within it, one passenger never takes
    // more than its own cap.
    expect(res.startedIds.length).toBeLessThanOrEqual(maxSubmitPerCompany());
    const aCount = started.filter((s) => s.trip.rider_id === "riderA").length;
    expect(aCount).toBeLessThanOrEqual(MAX_CONCURRENT_JOBS_PER_RIDER);
    // Remaining same-passenger bills stay parked, not failed.
    expect(records.filter((r) => r.status === "queued").length).toBeGreaterThan(0);
  });

  it("releases the next same-passenger bill as its slots free up", async () => {
    const records = [
      makeRecord("1", { riderId: "riderA", status: "submitting", jobId: "job1" }),
      makeRecord("2", { riderId: "riderA", status: "submitting", jobId: "job2" }),
      makeRecord("3", { riderId: "riderA" }),
      makeRecord("4", { riderId: "riderB" }),
    ];
    const { supabase } = makeFakeDb(records);

    // Both riderA sessions live: only riderB may start.
    let res = await dispatchNextQueued(supabase, "actor", "co1");
    expect(res.startedIds).toEqual(["4"]);

    // One riderA job finishes → the parked riderA bill goes automatically.
    records[0]!.status = "submitted";
    started.length = 0;
    res = await dispatchNextQueued(supabase, "actor", "co1");
    expect(res.startedIds).toEqual(["3"]);
  });
});
