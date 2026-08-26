/**
 * CONTROLLED CONCURRENCY GUARANTEES for HCPF submissions.
 *
 * Nothing here touches the live automation service or production data:
 * `startRobotSubmission` is mocked and any real fetch throws.
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
  looksLikeRetryableTimeout: (m: string) => /timed out|timeout/i.test(String(m ?? "")),
  hasExplicitPreSubmitFailureEvidence: (m: string) =>
    /pre_submit|submit_reached\s*[:=]\s*false|stage\s*[:=]\s*(login|launch|step1)/i.test(
      String(m ?? ""),
    ),
  looksLikePossiblySubmittedTimeout: (m: string) =>
    /SubmitClaimProf3|after clicking (?:Submit|Confirm)/i.test(String(m ?? "")) &&
    /timed out|timeout|closed/i.test(String(m ?? "")),
}));

import { makeFakeDb, makeRecord } from "./fakeQueueDb";
import {
  MAX_CONCURRENT_ROBOT_JOBS,
  MAX_CONCURRENT_JOBS_PER_RIDER,
} from "@/lib/robotQueue.server";
import {
  dispatchLeasedSubmissions,
  runSubmissionQueueTick,
  maxSubmitPerCompany,
} from "@/lib/submissionQueue.server";

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

describe("configured limits", () => {
  it("is a conservative 4 per account and 1 per rider", () => {
    expect(maxSubmitPerCompany()).toBe(4);
    expect(MAX_CONCURRENT_ROBOT_JOBS).toBe(4);
    expect(MAX_CONCURRENT_JOBS_PER_RIDER).toBe(1);
  });

  it("hard-clamps configuration to 1..4", () => {
    const prev = process.env["SUBMIT_MAX_PER_COMPANY"];
    process.env["SUBMIT_MAX_PER_COMPANY"] = "50";
    expect(maxSubmitPerCompany()).toBe(4);
    process.env["SUBMIT_MAX_PER_COMPANY"] = "0";
    expect(maxSubmitPerCompany()).toBe(1);
    if (prev === undefined) delete process.env["SUBMIT_MAX_PER_COMPANY"];
    else process.env["SUBMIT_MAX_PER_COMPANY"] = prev;
  });
});

describe("dispatch invariants", () => {
  it("never dispatches the same bill twice under parallel dispatchers", async () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);

    const runs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        dispatchLeasedSubmissions(supabase, null, { worker: `w${i}` }),
      ),
    );
    const ids = runs.flatMap((r) => r.startedIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(maxSubmitPerCompany());
    expect(started.length).toBe(ids.length);
  });

  it("runs at most 4 claims for one company at a time", async () => {
    const records = Array.from({ length: 15 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    expect(records.filter((r) => r.status === "submitting").length).toBe(4);
  });

  it("runs at most 1 live claim per rider", async () => {
    const records = [
      ...Array.from({ length: 4 }, (_, i) => makeRecord(`a${i}`, { riderId: "shared" })),
      makeRecord("b0", { riderId: "other" }),
    ];
    const { supabase } = makeFakeDb(records);
    await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    const liveShared = records.filter((r) => r.status === "submitting" && r.id.startsWith("a"));
    expect(liveShared.length).toBe(1);
  });

  it("runs different riders concurrently", async () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `rider-${i}` }),
    );
    const { supabase } = makeFakeDb(records);
    const res = await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    expect(res.started).toBe(4);
    expect(new Set(started.map((s) => s.trip.rider_id)).size).toBe(4);
  });

  it("keeps companies independent: a busy tenant never blocks another", async () => {
    const records = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeRecord(`a${i}`, { company: "co-a", riderId: `ra${i}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeRecord(`b${i}`, { company: "co-b", riderId: `rb${i}` }),
      ),
    ];
    const { supabase } = makeFakeDb(records);
    await dispatchLeasedSubmissions(supabase, null, { worker: "w" });
    const live = (co: string) =>
      records.filter((r) => r.company_id === co && r.status === "submitting").length;
    expect(live("co-a")).toBe(4);
    expect(live("co-b")).toBe(4);
  });

  it("starts zero work while the queue is paused", async () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      makeRecord(String(i + 1), { riderId: `r${i}` }),
    );
    const { supabase } = makeFakeDb(records, { paused: true, pause_reason: "Incident hold" });
    const tick = await runSubmissionQueueTick(supabase, { actorId: null });
    expect(tick.ran).toBe(false);
    expect(tick.started).toBe(0);
    expect(started.length).toBe(0);
    expect(records.every((r) => r.status === "queued")).toBe(true);
  });
});
