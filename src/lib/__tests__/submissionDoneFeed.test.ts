/**
 * DONE section counters + immediate refill after a success.
 * Nothing here touches the network: the robot is mocked, the DB is a fake.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const started: string[] = [];

vi.mock("@/lib/billingHelpers", async () => ({
  startRobotSubmission: vi.fn(async (_sb: any, args: any) => {
    started.push(args.billingRecordId);
    args.trip.robot_job_id = `job-${args.billingRecordId}`;
    args.trip.robot_job_started_at = new Date().toISOString();
  }),
  logAudit: vi.fn(async () => {}),
  looksLikeRetryableTimeout: (m: string) => /timed out|timeout/i.test(String(m ?? "")),
  looksLikePossiblySubmittedTimeout: () => false,
}));

// Reconcile is the "a claim finished" signal. The first sweep settles the
// in-flight job by marking it submitted, exactly as production reconcile does.
const settleQueue: Array<(sb: any) => Promise<void>> = [];
vi.mock("@/lib/robotQueue.server", async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    reconcileInFlight: vi.fn(async (sb: any) => {
      const next = settleQueue.shift();
      if (!next) return { checked: 0, settled: 0 };
      await next(sb);
      return { checked: 1, settled: 1 };
    }),
  };
});

import { makeFakeDb, makeRecord } from "./fakeQueueDb";
import { runSubmissionQueueTick } from "@/lib/submissionQueue.server";
import { getDoneFeed } from "@/lib/submissionDone.server";

beforeEach(() => {
  started.length = 0;
  settleQueue.length = 0;
});

function feedDb(rows: any[]) {
  // Minimal read-only stub in the shape getDoneFeed queries.
  const api = {
    from(table: string) {
      const q: any = {
        _rows: table === "billing_records" ? rows : [],
        select() {
          return q;
        },
        in(col: string, vals: string[]) {
          q._rows = q._rows.filter((r: any) => vals.includes(r[col]));
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return Promise.resolve({ data: q._rows });
        },
        then(res: any) {
          return Promise.resolve({ data: q._rows }).then(res);
        },
      };
      return q;
    },
  };
  return api as any;
}

describe("done feed counters", () => {
  const rows = [
    { id: "1", trip_id: "t1", status: "submitted", state_confirmation_number: "23262370012", submitted_at: "2026-08-25T10:00:00Z", submit_batch_id: null, medicaid_trips: { riders: { full_name: "Ann Reed" } } },
    { id: "2", trip_id: "t2", status: "paid", state_confirmation_number: "23262370013", submitted_at: "2026-08-25T10:01:00Z", submit_batch_id: null, medicaid_trips: { riders: { full_name: "Bob Ray" } } },
    { id: "3", trip_id: "t3", status: "queued", submitted_at: null, submit_batch_id: null, medicaid_trips: {} },
    { id: "4", trip_id: "t4", status: "queued", submitted_at: null, submit_batch_id: null, medicaid_trips: {} },
    { id: "5", trip_id: "t5", status: "submitting", submitted_at: null, submit_batch_id: null, medicaid_trips: {} },
    { id: "6", trip_id: "t6", status: "needs_fix", requires_human_step: true, submitted_at: null, submit_batch_id: null, medicaid_trips: {} },
    { id: "7", trip_id: "t7", status: "needs_fix", requires_human_step: false, submitted_at: null, submit_batch_id: null, medicaid_trips: {} },
  ];

  it("splits done from queued / processing / verifying / needs attention", async () => {
    const feed = await getDoneFeed(feedDb(rows));
    expect(feed.counters).toEqual({
      queued: 2,
      processing: 1,
      verifying: 1,
      needs_attention: 1,
      done: 2,
    });
  });

  it("returns claim IDs, completion times and passenger for the history table", async () => {
    const feed = await getDoneFeed(feedDb(rows));
    expect(feed.claims.map((c) => c.claimId)).toEqual(["23262370012", "23262370013"]);
    expect(feed.claims[0]!.passenger).toBe("Ann Reed");
    expect(feed.completions).toHaveLength(2);
  });

  it("done increments as a claim finishes (20-bill batch view)", async () => {
    const batch = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      trip_id: `tb${i}`,
      status: i === 0 ? "submitting" : i < 16 ? "queued" : "submitted",
      state_confirmation_number: i >= 16 ? `claim-${i}` : null,
      submitted_at: i >= 16 ? "2026-08-25T10:00:00Z" : null,
      submit_batch_id: null,
      medicaid_trips: {},
    }));
    const before = await getDoneFeed(feedDb(batch));
    expect(before.counters).toMatchObject({ processing: 1, queued: 15, done: 4 });

    batch[0]!.status = "submitted";
    batch[0]!.state_confirmation_number = "claim-0";
    batch[0]!.submitted_at = "2026-08-25T10:01:00Z";
    batch[1]!.status = "submitting";
    const after = await getDoneFeed(feedDb(batch));
    expect(after.counters).toMatchObject({ processing: 1, queued: 14, done: 5 });
  });
});

describe("immediate refill after a successful claim", () => {
  it("dispatches the next queued bill in the same tick, with no success cooldown", async () => {
    const a = makeRecord("1", { status: "queued" });
    const b = makeRecord("2", { status: "queued" });
    const { supabase } = makeFakeDb([a, b]);

    // First reconcile settles nothing (nothing in flight yet); the second one
    // finishes bill 1, which must immediately free the single-flight slot.
    settleQueue.push(async () => {
      a.status = "submitted";
      a.state_confirmation_number = "2326237001236";
    });

    const tick = await runSubmissionQueueTick(supabase, {
      actorId: null,
      refill: true,
      refillPollMs: 250,
      refillMaxRounds: 3,
    });

    expect(started).toEqual(["1", "2"]);
    expect(tick.started).toBe(2);
    expect(tick.settled).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("does not refill when refill is off (UI kick returns immediately)", async () => {
    const a = makeRecord("1", { status: "queued" });
    const b = makeRecord("2", { status: "queued" });
    const { supabase } = makeFakeDb([a, b]);
    settleQueue.push(async () => {
      a.status = "submitted";
    });
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.started).toBe(1);
    expect(started).toEqual(["1"]);
  });
});
