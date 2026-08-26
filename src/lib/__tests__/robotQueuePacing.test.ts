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
  hasExplicitPreSubmitFailureEvidence: (m: string) => /pre_submit|submit_reached\s*[:=]\s*false|stage\s*[:=]\s*(login|launch|step1)/i.test(String(m ?? "")),
  looksLikePossiblySubmittedTimeout: () => false,
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

    // Controlled capacity: one company never exceeds its account cap.
    expect(res.startedIds.length).toBeLessThanOrEqual(maxSubmitPerCompany());
    const aCount = started.filter((s) => s.trip.rider_id === "riderA").length;
    expect(aCount).toBeLessThanOrEqual(MAX_CONCURRENT_JOBS_PER_RIDER);
    // Remaining bills stay parked, not failed.
    expect(records.filter((r) => r.status === "queued").length).toBeGreaterThan(0);
  });

  it("releases the same rider's next bill only after the live job is terminal", async () => {
    const records = [
      makeRecord("1", { riderId: "riderA", status: "submitting", jobId: "job1" }),
      makeRecord("2", { riderId: "riderA" }),
    ];
    const { supabase } = makeFakeDb(records);

    // A session is live for this rider: their next bill may not start.
    let res = await dispatchNextQueued(supabase, "actor", "co1");
    expect(res.startedIds).toEqual([]);
    expect(started.length).toBe(0);

    // The live job finishes → the queued bill for that rider goes.
    records[0]!.status = "submitted";
    records[0]!.medicaid_trips.robot_job_id = null;
    res = await dispatchNextQueued(supabase, "actor", "co1");
    expect(res.startedIds).toEqual(["2"]);
    expect(started.length).toBe(1);
  });

  it("runs different riders concurrently up to the account cap", async () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `rider-${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    const res = await dispatchNextQueued(supabase, "actor", "co1");
    expect(res.startedIds.length).toBe(maxSubmitPerCompany());
    expect(new Set(started.map((s) => s.trip.rider_id)).size).toBe(maxSubmitPerCompany());
  });
});

