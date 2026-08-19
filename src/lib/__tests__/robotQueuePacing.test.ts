import { describe, it, expect, vi, beforeEach } from "vitest";

const started: any[] = [];
vi.mock("@/lib/billingHelpers", () => ({
  startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
    started.push(args);
  }),
  logAudit: vi.fn(async () => {}),
}));

import {
  dispatchNextQueued,
  MAX_CONCURRENT_JOBS_PER_RIDER,
  MAX_CONCURRENT_ROBOT_JOBS,
} from "@/lib/robotQueue.server";

/** Minimal fake of the supabase query builder used by the queue module. */
function makeSupabase(records: any[]) {
  return {
    from(_t: string) {
      const state: any = { op: "select", filters: {}, updates: null };
      const builder: any = {
        select: () => builder,
        update: (u: any) => {
          state.op = "update";
          state.updates = u;
          return builder;
        },
        eq: (col: string, val: any) => {
          state.filters[col] = val;
          if (state.op === "update" && col === "id") state.id = val;
          return builder;
        },
        in: () => builder,
        order: () => builder,
        limit: (n: number) => {
          state.limit = n;
          return builder;
        },
        then: (resolve: any) => resolve(run()),
      };
      function run() {
        if (state.op === "update") {
          const rec = records.find(
            (r) => r.id === state.id && (!state.filters.status || r.status === state.filters.status),
          );
          if (!rec) return { data: [], error: null };
          Object.assign(rec, state.updates);
          return { data: [{ id: rec.id }], error: null };
        }
        let out = records.filter((r) => r.status === state.filters.status);
        if (state.filters.company_id) out = out.filter((r) => r.company_id === state.filters.company_id);
        if (state.limit) out = out.slice(0, state.limit);
        return { data: out, error: null };
      }
      return builder;
    },
  } as any;
}

function rec(id: string, riderId: string, status: string, jobId?: string) {
  return {
    id,
    status,
    company_id: "co1",
    updated_at: `2026-08-19T00:00:${id.padStart(2, "0")}Z`,
    medicaid_trips: {
      id: `t${id}`,
      company_id: "co1",
      rider_id: riderId,
      riders: { medicaid_id: riderId },
      robot_job_id: jobId ?? null,
      robot_job_started_at: jobId ? new Date().toISOString() : null,
    },
  };
}

describe("per-passenger dispatch pacing", () => {
  beforeEach(() => {
    started.length = 0;
  });

  it("throttles one passenger to the per-rider cap while others run at full speed", async () => {
    // 6 queued bills for rider A (the grouped-by-passenger batch)
    // + 5 queued bills for distinct riders B..F.
    const records = [
      ...Array.from({ length: 6 }, (_, i) => rec(`${i + 1}`, "riderA", "queued")),
      ...["B", "C", "D", "E", "F"].map((r, i) => rec(`${i + 7}`, `rider${r}`, "queued")),
    ];
    const sb = makeSupabase(records);

    const res = await dispatchNextQueued(sb, "actor", "co1");

    expect(res.startedIds.length).toBe(MAX_CONCURRENT_ROBOT_JOBS - 1); // 6 distinct + 2 riderA - overlap
    const startedRiders = started.map((s) => s.trip.rider_id);
    const aCount = startedRiders.filter((r) => r === "riderA").length;
    expect(aCount).toBe(MAX_CONCURRENT_JOBS_PER_RIDER);
    // every other rider got a slot immediately
    expect(new Set(startedRiders.filter((r) => r !== "riderA")).size).toBe(5);
    // the remaining riderA bills stay parked
    expect(records.filter((r) => r.status === "queued").length).toBe(4);
  });

  it("releases the next same-passenger bill as its slots free up", async () => {
    const records = [
      rec("1", "riderA", "submitting", "job1"),
      rec("2", "riderA", "submitting", "job2"),
      rec("3", "riderA", "queued"),
      rec("4", "riderB", "queued"),
    ];
    const sb = makeSupabase(records);

    // Both riderA sessions live: only riderB may start.
    let res = await dispatchNextQueued(sb, "actor", "co1");
    expect(res.startedIds).toEqual(["4"]);

    // One riderA job finishes → the parked riderA bill goes automatically.
    records[0].status = "submitted";
    started.length = 0;
    res = await dispatchNextQueued(sb, "actor", "co1");
    expect(res.startedIds).toEqual(["3"]);
  });
});
