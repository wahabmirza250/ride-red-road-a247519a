/**
 * "Processing" must mean a robot is holding this bill RIGHT NOW.
 * Historical robot_last_status='SUBMITTED' is never enough.
 */
import { describe, expect, it } from "vitest";
import {
  hasLiveSubmissionLease,
  isActivelyProcessing,
  correctedDisplayStage,
  splitCorrectedProcessing,
} from "@/lib/processingLive";
import {
  nextSearchAction,
  searchBackoffMs,
  SEARCH_MAX_POSTS,
  SEARCH_JOB_MAX_POLLS,
} from "@/lib/searchLedger";

const now = Date.parse("2026-09-08T12:00:00Z");
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("live lease", () => {
  it("counts an unexpired lease with a fresh heartbeat", () => {
    expect(
      hasLiveSubmissionLease(
        { submit_locked_until: iso(-60_000), submit_heartbeat_at: iso(30_000) },
        now,
      ),
    ).toBe(true);
  });

  it("drops an expired lease immediately", () => {
    expect(
      hasLiveSubmissionLease(
        { submit_locked_until: iso(60_000), submit_heartbeat_at: iso(30 * 60_000) },
        now,
      ),
    ).toBe(false);
  });

  it("drops a lease whose worker stopped sending heartbeats", () => {
    expect(
      hasLiveSubmissionLease(
        { submit_locked_until: iso(600_000), submit_heartbeat_at: iso(60 * 60_000) },
        now,
      ),
    ).toBe(false);
  });

  it("never calls a historical SUBMITTED status 'processing'", () => {
    expect(
      isActivelyProcessing(
        { status: "needs_fix", robot_last_status: "SUBMITTED" } as any,
        now,
      ),
    ).toBe(false);
  });
});

describe("corrected copies", () => {
  const live = { submit_locked_until: iso(-60_000), submit_heartbeat_at: iso(10_000) };

  it("shows a lease-less corrected copy as Verification Hold, not Processing", () => {
    expect(correctedDisplayStage({ resubmission_status: "processing", record: null }, now)).toBe(
      "verification_hold",
    );
  });

  it("keeps a genuinely running corrected copy in Processing", () => {
    expect(correctedDisplayStage({ resubmission_status: "processing", record: live as any }, now)).toBe("processing");
  });

  it("splits a mixed batch", () => {
    const rows = [
      { id: "a", submission_billing_record_id: "b1" },
      { id: "b", submission_billing_record_id: "b2" },
      { id: "c", submission_billing_record_id: null },
    ];
    const split = splitCorrectedProcessing(rows, new Map([["b1", live as any]]), now);
    expect(split.processing.map((r) => r.id)).toEqual(["a"]);
    expect(split.verification_hold.map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("durable search ledger", () => {
  it("polls an existing running job instead of opening a new portal session", () => {
    const act = nextSearchAction(
      { state: "running", job_id: "j1", started_at: iso(30_000), poll_attempts: 2, post_attempts: 1 },
      now,
    );
    expect(act.kind).toBe("poll");
  });

  it("never posts a second search while one is running", () => {
    const kinds = new Set(
      [1, 5, 30].map(
        (s) =>
          nextSearchAction(
            { state: "running", job_id: "j1", started_at: iso(s * 1000), poll_attempts: 1, post_attempts: 1 },
            now,
          ).kind,
      ),
    );
    expect(kinds.has("start")).toBe(false);
  });

  it("backs off exponentially between retries", () => {
    expect(searchBackoffMs(2)).toBeGreaterThan(searchBackoffMs(1));
    expect(searchBackoffMs(5)).toBeGreaterThan(searchBackoffMs(3));
  });

  it("gives up after a bounded number of attempts instead of looping forever", () => {
    expect(
      nextSearchAction(
        { state: "error", job_id: null, started_at: iso(60_000), poll_attempts: 0, post_attempts: SEARCH_MAX_POSTS },
        now,
      ).kind,
    ).toBe("exhausted");
    expect(
      nextSearchAction(
        {
          state: "running",
          job_id: "j1",
          started_at: iso(60_000),
          poll_attempts: SEARCH_JOB_MAX_POLLS,
          post_attempts: 1,
        },
        now,
      ).kind,
    ).toBe("exhausted");
  });
});
