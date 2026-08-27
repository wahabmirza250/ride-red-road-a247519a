/**
 * REGRESSION: a quarantined / human-verification bill must never be left
 * counted as an active `submitting` row.
 *
 * Production incident: 4 billing_records sat in status='submitting' for hours
 * while their trip was NEEDS_HUMAN_LOOKUP with requires_human_step=true.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/billingHelpers", () => ({
  logAudit: vi.fn(async () => {}),
  UNVERIFIED_SUBMIT_STATUS: "SUBMITTED_UNVERIFIED",
  ROBOT_BASE_URL: "https://robot.test",
}));

import {
  isQuarantinedRobotStatus,
  isActiveVerifyRobotStatus,
  shouldLeaveSubmitting,
  INFLIGHT_HARD_CEILING_MS,
} from "@/lib/robotJobLost";
import { quarantineForHumanVerification } from "@/lib/robotJobLost.server";
import { recoverStuckInFlightSubmissions } from "@/lib/submissionQueue.server";

type Write = { table: string; patch: any; id: string };

function db(rows: any[]) {
  const writes: Write[] = [];
  const supabase = {
    from(table: string) {
      const ctx: any = { patch: null };
      const api: any = {
        select: () => api,
        update: (patch: any) => {
          ctx.patch = patch;
          return api;
        },
        insert: () => Promise.resolve({ data: null, error: null }),
        order: () => api,
        eq: (_c: string, v: any) => {
          if (ctx.patch) {
            writes.push({ table, patch: ctx.patch, id: v });
            ctx.patch = null;
            return Promise.resolve({ data: null, error: null });
          }
          if (table === "billing_records") return thenable();
          return api;
        },
      };
      function thenable() {
        const t: any = {
          eq: () => t,
          order: () => t,
          then: (res: any) => res({ data: rows, error: null }),
        };
        return t;
      }
      if (table === "billing_records") {
        api.select = () => thenable();
      }
      return api;
    },
  };
  return { supabase, writes };
}

describe("quarantine classification", () => {
  it("treats NEEDS_HUMAN_LOOKUP as quarantined, not active", () => {
    expect(isQuarantinedRobotStatus("NEEDS_HUMAN_LOOKUP")).toBe(true);
    expect(isActiveVerifyRobotStatus("NEEDS_HUMAN_LOOKUP")).toBe(false);
    expect(isActiveVerifyRobotStatus("SUBMITTED_UNVERIFIED")).toBe(true);
    expect(isActiveVerifyRobotStatus("JOB_NOT_FOUND")).toBe(true);
  });

  it("pulls quarantined and human-flagged rows out of submitting", () => {
    expect(shouldLeaveSubmitting({ robotStatus: "NEEDS_HUMAN_LOOKUP" })).toBe(true);
    expect(shouldLeaveSubmitting({ robotStatus: "running", requiresHumanStep: true })).toBe(true);
    expect(shouldLeaveSubmitting({ robotStatus: "running", startedAt: Date.now() })).toBe(false);
    expect(
      shouldLeaveSubmitting({
        robotStatus: "SUBMITTED_UNVERIFIED",
        startedAt: Date.now() - INFLIGHT_HARD_CEILING_MS - 1,
      }),
    ).toBe(true);
  });
});

describe("quarantineForHumanVerification", () => {
  it("leaves submitting, flags the human step and never schedules a retry", async () => {
    const { supabase, writes } = db([]);
    const out = await quarantineForHumanVerification(supabase as any, {
      recordId: "r1",
      tripId: "t1",
      actorId: null,
      message: "manual portal check required",
    });
    expect(out.pending).toBe(false);
    const w = writes.find((x) => x.table === "billing_records")!;
    expect(w.patch.status).toBe("needs_fix");
    expect(w.patch.status).not.toBe("submitting");
    expect(w.patch.requires_human_step).toBe(true);
    expect(w.patch.submit_next_attempt_at).toBeNull();
    expect(w.patch.submit_locked_until).toBeNull();
    // Evidence is never cleared.
    expect(w.patch).not.toHaveProperty("robot_job_id");
    expect(w.patch).not.toHaveProperty("submit_idempotency_key");
    expect(w.patch).not.toHaveProperty("submit_account_key");
    expect(w.patch).not.toHaveProperty("state_confirmation_number");
    expect(w.patch).not.toHaveProperty("submit_attempt_count");
  });
});

describe("recoverStuckInFlightSubmissions", () => {
  it("rescues a NEEDS_HUMAN_LOOKUP row stuck in submitting", async () => {
    const { supabase, writes } = db([
      {
        id: "r1",
        trip_id: "t1",
        requires_human_step: true,
        submission_error: "needs manual portal check",
        updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        medicaid_trips: {
          id: "t1",
          robot_job_id: "job-1",
          robot_job_started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          robot_last_status: "NEEDS_HUMAN_LOOKUP",
          robot_last_message: "needs manual portal check",
        },
      },
    ]);
    const n = await recoverStuckInFlightSubmissions(supabase as any, null);
    expect(n).toBe(1);
    const w = writes.find((x) => x.table === "billing_records")!;
    expect(w.patch.status).toBe("needs_fix");
    expect(w.patch.requires_human_step).toBe(true);
    expect(w.patch.submit_next_attempt_at).toBeNull();
  });

  it("leaves a fresh SUBMITTED_UNVERIFIED row alone (search still owns it)", async () => {
    const { supabase, writes } = db([
      {
        id: "r2",
        trip_id: "t2",
        requires_human_step: true,
        submission_error: null,
        updated_at: new Date().toISOString(),
        medicaid_trips: {
          id: "t2",
          robot_job_id: "job-2",
          robot_job_started_at: new Date().toISOString(),
          robot_last_status: "SUBMITTED_UNVERIFIED",
          robot_last_message: null,
        },
      },
    ]);
    const n = await recoverStuckInFlightSubmissions(supabase as any, null);
    expect(n).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("quarantines an unresolved SUBMITTED_UNVERIFIED row past the ceiling without retrying", async () => {
    const old = new Date(Date.now() - INFLIGHT_HARD_CEILING_MS - 60_000).toISOString();
    const { supabase, writes } = db([
      {
        id: "r3",
        trip_id: "t3",
        requires_human_step: false,
        submission_error: null,
        updated_at: old,
        medicaid_trips: {
          id: "t3",
          robot_job_id: "job-3",
          robot_job_started_at: old,
          robot_last_status: "SUBMITTED_UNVERIFIED",
          robot_last_message: null,
        },
      },
    ]);
    const n = await recoverStuckInFlightSubmissions(supabase as any, null);
    expect(n).toBe(1);
    const w = writes.find((x) => x.table === "billing_records")!;
    expect(w.patch.status).toBe("needs_fix");
    expect(w.patch.submit_next_attempt_at).toBeNull();
    expect(w.patch.status).not.toBe("queued");
  });
});
