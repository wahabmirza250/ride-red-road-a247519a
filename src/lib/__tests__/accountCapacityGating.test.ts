/**
 * Provider-account capacity gating must never be wedged by rows that sit in
 * `submitting` while awaiting read-only/manual verification.
 */
import { describe, it, expect } from "vitest";
import { listActiveRobotJobs, MAX_CONCURRENT_ROBOT_JOBS } from "@/lib/robotQueue.server";

function fakeDb(rows: any[]) {
  const q: any = {
    select: () => q,
    eq: () => q,
    then: undefined,
  };
  // The call chain is awaited directly, so make the builder thenable.
  q.then = (resolve: any) => resolve({ data: rows, error: null });
  return { from: () => q };
}

const row = (id: string, status: string | null, riderId = "r1") => ({
  id,
  medicaid_trips: {
    robot_job_id: `job-${id}`,
    robot_job_started_at: new Date().toISOString(),
    robot_last_status: status,
    rider_id: riderId,
    riders: { medicaid_id: "M1" },
  },
});

describe("live portal session accounting", () => {
  it("ignores SUBMITTED_UNVERIFIED and NEEDS_HUMAN_LOOKUP rows", async () => {
    const db = fakeDb([
      row("a", "SUBMITTED_UNVERIFIED"),
      row("b", "NEEDS_HUMAN_LOOKUP"),
      row("c", "JOB_NOT_FOUND"),
    ]);
    const live = await listActiveRobotJobs(db as any, { companyId: "co" });
    expect(live).toHaveLength(0);
  });

  it("still counts genuinely running jobs", async () => {
    const db = fakeDb([row("a", "RUNNING", "r1"), row("b", "SUBMITTING", "r2")]);
    const live = await listActiveRobotJobs(db as any, { companyId: "co" });
    expect(live.map((l) => l.id).sort()).toEqual(["a", "b"]);
  });

  it("allows more than one concurrent session per account", () => {
    expect(MAX_CONCURRENT_ROBOT_JOBS).toBeGreaterThan(1);
  });
});
