/**
 * INCIDENT GUARD: a lost/orphaned robot job (Railway restart erases in-memory
 * job ids, so /job-status/<id> 404s forever) must never leave a bill stuck in
 * `submitting`, and must NEVER trigger an automatic retry.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/billingHelpers", () => ({
  logAudit: vi.fn(async () => {}),
  UNVERIFIED_SUBMIT_STATUS: "SUBMITTED_UNVERIFIED",
}));

import {
  INFLIGHT_CEILING_VERIFY_MESSAGE,
  JOB_NOT_FOUND_STATUS,
  LOST_JOB_CONFIRM_WINDOW_MS,
  exceededInFlightCeiling,
  isJobNotFoundResponse,
  lostJobDecision,
} from "@/lib/robotJobLost";
import { handleLostRobotJob, routeToNeedsVerification } from "@/lib/robotJobLost.server";
import { claimProgress, claimStageOf } from "@/lib/robotProgress";

/** Minimal supabase stand-in recording table updates. */
function fakeDb() {
  const writes: Array<{ table: string; patch: any; id: string }> = [];
  const supabase = {
    from(table: string) {
      const ctx: any = { table, patch: null };
      const api: any = {
        update(patch: any) {
          ctx.patch = patch;
          return api;
        },
        eq(_col: string, id: string) {
          if (ctx.patch) writes.push({ table, patch: ctx.patch, id });
          ctx.patch = null;
          return Promise.resolve({ data: null, error: null });
        },
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
  return { supabase, writes };
}

describe("lost job detection", () => {
  it("treats 404 / 410 / not-found bodies as a lost job", () => {
    expect(isJobNotFoundResponse(404, "Not Found")).toBe(true);
    expect(isJobNotFoundResponse(410, "")).toBe(true);
    expect(isJobNotFoundResponse(200, '{"error":"unknown job"}')).toBe(true);
    expect(isJobNotFoundResponse(502, "bad gateway")).toBe(false);
    expect(isJobNotFoundResponse(500, "boom")).toBe(false);
  });

  it("waits inside the bounded confirmation window, then verifies", () => {
    const now = Date.now();
    expect(lostJobDecision({ firstSeenAt: null, now })).toBe("wait");
    expect(lostJobDecision({ firstSeenAt: now - 10_000, now })).toBe("wait");
    expect(
      lostJobDecision({ firstSeenAt: now - LOST_JOB_CONFIRM_WINDOW_MS - 1, now }),
    ).toBe("verify");
  });

  it("has an absolute in-flight ceiling", () => {
    const now = Date.now();
    expect(exceededInFlightCeiling(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(exceededInFlightCeiling(new Date(now - 45 * 60_000).toISOString(), now)).toBe(true);
    expect(exceededInFlightCeiling(null, now)).toBe(false);
  });
});

describe("orphaned 404 job handling", () => {
  it("first 404 only marks the job as not found — no retry, no state change", async () => {
    const { supabase, writes } = fakeDb();
    const out = await handleLostRobotJob(supabase, {
      recordId: "r1",
      tripId: "t1",
      actorId: null,
      robotLastStatus: "running",
      robotLastCheckedAt: null,
    });
    expect(out.pending).toBe(true);
    expect(out.status).toBe(JOB_NOT_FOUND_STATUS);
    expect(writes.every((w) => w.table === "medicaid_trips")).toBe(true);
    // The billing record is untouched: nothing is re-queued.
    expect(writes.some((w) => w.table === "billing_records")).toBe(false);
  });

  it("keeps waiting inside the window WITHOUT resetting the first-seen time", async () => {
    const { supabase, writes } = fakeDb();
    const out = await handleLostRobotJob(supabase, {
      recordId: "r1",
      tripId: "t1",
      actorId: null,
      robotLastStatus: JOB_NOT_FOUND_STATUS,
      robotLastCheckedAt: new Date(Date.now() - 5_000).toISOString(),
    });
    expect(out.pending).toBe(true);
    expect(writes.length).toBe(0);
  });

  it("routes an ambiguous lost job to Needs Verification, preserving evidence", async () => {
    const { supabase, writes } = fakeDb();
    const out = await handleLostRobotJob(supabase, {
      recordId: "r1",
      tripId: "t1",
      actorId: null,
      robotLastStatus: JOB_NOT_FOUND_STATUS,
      robotLastCheckedAt: new Date(Date.now() - LOST_JOB_CONFIRM_WINDOW_MS - 1).toISOString(),
    });
    expect(out.pending).toBe(false);
    expect(out.status).toBe("SUBMITTED_UNVERIFIED");

    const rec = writes.find((w) => w.table === "billing_records")!;
    expect(rec.patch.requires_human_step).toBe(true);
    expect(rec.patch.status).toBe("submitting"); // never "queued" / "approved"
    expect(rec.patch.failure_code).toBe("job_lost_unverified");
    // The lease is released, but no portal evidence is cleared.
    expect(rec.patch.submit_locked_until).toBeNull();
    expect(rec.patch).not.toHaveProperty("submit_idempotency_key");
    expect(rec.patch).not.toHaveProperty("submit_account_key");
    expect(rec.patch).not.toHaveProperty("submit_attempt_count");
    expect(rec.patch).not.toHaveProperty("state_confirmation_number");

    const trip = writes.find((w) => w.table === "medicaid_trips")!;
    expect(trip.patch.robot_last_status).toBe("SUBMITTED_UNVERIFIED");
    expect(trip.patch).not.toHaveProperty("robot_job_id");
  });

  it("never marks a lost job as submitted or ready", async () => {
    const { supabase, writes } = fakeDb();
    await routeToNeedsVerification(supabase, {
      recordId: "r1",
      tripId: "t1",
      actorId: null,
      message: INFLIGHT_CEILING_VERIFY_MESSAGE,
      failureCode: "inflight_ceiling_unverified",
    });
    const rec = writes.find((w) => w.table === "billing_records")!;
    expect(["submitted", "approved", "queued"]).not.toContain(rec.patch.status);
    expect(rec.patch.submit_next_attempt_at).toBeNull(); // no scheduled retry
  });
});

describe("per-claim progress display", () => {
  it("maps known robot stages", () => {
    expect(claimStageOf("queued", null).label).toBe("Waiting");
    expect(claimStageOf("submitting", "PORTAL_LOGIN").label).toBe("Opening HCPF");
    expect(claimStageOf("submitting", "STEP1_CLAIM_INFO").label).toBe("Entering claim");
    expect(claimStageOf("submitting", "SERVICE_LINES").label).toBe("Adding service lines");
    expect(claimStageOf("submitting", "SUBMITTING").label).toBe("Submitting");
    expect(claimStageOf("submitting", "SUBMITTED_UNVERIFIED").label).toBe("Verifying");
    expect(claimStageOf("submitted", "SUBMITTED").label).toBe("Done");
  });

  it("says 'Working at HCPF' instead of faking progress", () => {
    expect(claimStageOf("submitting", null).label).toBe("Working at HCPF");
    expect(claimStageOf("submitting", "RUNNING").step).toBeNull();
  });

  it("reports elapsed time and warns on a slow claim", () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    const fresh = claimProgress({
      recordStatus: "submitting",
      robotStatus: null,
      startedAt: new Date(now - 90_000).toISOString(),
      now,
    });
    expect(fresh.elapsedLabel).toBe("1m 30s");
    expect(fresh.slow).toBe(false);

    const slow = claimProgress({
      recordStatus: "submitting",
      robotStatus: null,
      startedAt: new Date(now - 12 * 60_000).toISOString(),
      now,
    });
    expect(slow.slow).toBe(true);
    expect(slow.elapsedLabel).toBe("12m 0s");
  });
});
