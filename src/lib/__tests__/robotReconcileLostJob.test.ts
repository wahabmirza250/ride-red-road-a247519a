/**
 * Reconciler-level guards for the "stuck forever" incident:
 *   - a 404 job-status answer is orphaned/ambiguous, never a retry
 *   - a successful confirmation atomically stores the HCPF claim id
 *   - an explicit pre-Submit failure may become a safe review state
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/billingHelpers", () => ({
  logAudit: vi.fn(async () => {}),
  ROBOT_BASE_URL: "https://robot.test",
  UNVERIFIED_SUBMIT_STATUS: "SUBMITTED_UNVERIFIED",
  looksLikePossiblySubmittedTimeout: () => false,
  looksLikePostConfirmTimeout: () => false,
  looksLikeNoServiceLinesFailure: (m: string) => /no service line/i.test(String(m ?? "")),
}));

vi.mock("@/lib/robotFleet.server", () => ({
  pollBaseUrlFor: () => "https://robot.test",
}));

vi.mock("@/lib/autoRetry.server", () => ({
  maybeAutoRetryTimeout: vi.fn(async () => ({ retried: false, exhausted: false, message: null })),
}));

import { reconcileRobotJob } from "@/lib/robotReconcile.server";
import { maybeAutoRetryTimeout } from "@/lib/autoRetry.server";

type Writes = Array<{ table: string; patch: any; id: string }>;

function db(trip: any, rec: any) {
  const writes: Writes = [];
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
        eq: (_c: string, id: string) => {
          if (ctx.patch) {
            writes.push({ table, patch: ctx.patch, id });
            ctx.patch = null;
            return Promise.resolve({ data: null, error: null });
          }
          return api;
        },
        single: async () => ({ data: { ...rec, medicaid_trips: trip }, error: null }),
      };
      return api;
    },
  };
  return { supabase, writes };
}

const BASE_TRIP = {
  id: "t1",
  robot_job_id: "job-1",
  robot_pass: "full",
  robot_last_status: "running",
  robot_last_checked_at: null,
  robot_confirmation_number: null,
  submitted_confirmation: null,
};
const BASE_REC = { id: "r1", status: "submitting", trip_id: "t1", state_confirmation_number: null };

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: any) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    })),
  );
}

describe("reconcile: orphaned 404 job", () => {
  it("marks the job as not found and keeps the bill in flight — no retry", async () => {
    mockFetch(404, "Not Found");
    const { supabase, writes } = db({ ...BASE_TRIP }, { ...BASE_REC });
    const out = await reconcileRobotJob(supabase, "r1", null);
    expect(out.pending).toBe(true);
    expect(out.status).toBe("JOB_NOT_FOUND");
    expect(writes.some((w) => w.table === "billing_records")).toBe(false);
    expect(maybeAutoRetryTimeout).not.toHaveBeenCalled();
  });

  it("after the confirmation window it becomes Needs Verification, never Ready", async () => {
    mockFetch(404, "Not Found");
    const { supabase, writes } = db(
      {
        ...BASE_TRIP,
        robot_last_status: "JOB_NOT_FOUND",
        robot_last_checked_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
      { ...BASE_REC },
    );
    const out = await reconcileRobotJob(supabase, "r1", null);
    expect(out.status).toBe("SUBMITTED_UNVERIFIED");
    const rec = writes.find((w) => w.table === "billing_records")!;
    expect(rec.patch.requires_human_step).toBe(true);
    expect(rec.patch.status).toBe("submitting");
    expect(maybeAutoRetryTimeout).not.toHaveBeenCalled();
  });
});

describe("reconcile: terminal outcomes", () => {
  it("atomically stores the HCPF claim id on success", async () => {
    mockFetch(200, { status: "done", result: { status: "SUBMITTED", claim_id: "9426213001270" } });
    const { supabase, writes } = db({ ...BASE_TRIP }, { ...BASE_REC });
    const out = await reconcileRobotJob(supabase, "r1", null);
    expect(out.pending).toBe(false);
    const rec = writes.find((w) => w.table === "billing_records")!;
    expect(rec.patch.status).toBe("submitted");
    expect(rec.patch.state_confirmation_number).toBe("9426213001270");
    expect(rec.patch.submitted_at).toBeTruthy();
    expect(rec.patch.requires_human_step).toBe(false);
  });

  it("explicit pre-Submit failure (no service lines) becomes a safe Needs Fix", async () => {
    mockFetch(200, {
      status: "error",
      result: { status: "ERROR", reason: "no service line was committed" },
    });
    const { supabase, writes } = db({ ...BASE_TRIP }, { ...BASE_REC });
    const out = await reconcileRobotJob(supabase, "r1", null);
    const rec = writes.find((w) => w.table === "billing_records")!;
    expect(rec.patch.status).toBe("needs_fix");
    expect(rec.patch.requires_human_step).toBe(false);
    expect(out.message).toMatch(/No claim was created/i);
  });

  it("a transient poll failure (502) changes nothing", async () => {
    mockFetch(502, "bad gateway");
    const { supabase, writes } = db({ ...BASE_TRIP }, { ...BASE_REC });
    const out = await reconcileRobotJob(supabase, "r1", null);
    expect(out.pending).toBe(true);
    expect(out.status).toBe("poll_error");
    expect(writes.length).toBe(0);
  });
});
