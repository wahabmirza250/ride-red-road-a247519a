/**
 * REGRESSION COVER — 2026-08-31 22:16 UTC corrected-resubmission incident.
 *
 * Fourteen corrected claims were really dispatched to the robot fleet, but the
 * shared reconciler short-circuited on the ORIGINAL denied claim number that
 * still lives on the shared `medicaid_trips` row ("Already submitted — portal
 * confirmation #<ORIGINAL>"), never polled the corrected jobs, and the stuck-job
 * sweep then quarantined the corrected records with "Claim already exists at
 * the portal".
 *
 * These tests pin the contract:
 *   - a corrected record polls ITS job, never early-returns the original claim;
 *   - a NEW claim number is written to the corrected rows only;
 *   - the ORIGINAL claim number coming back is HELD, never "submitted";
 *   - the original trip and the original denied bill are byte-for-byte intact;
 *   - recovery only ever performs read-only GET /job-status polls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logAudit = vi.fn(async () => {});
vi.mock("@/lib/billingHelpers", () => ({
  logAudit: (...a: any[]) => logAudit(...(a as [])),
  ROBOT_BASE_URL: "https://robot.test",
  UNVERIFIED_SUBMIT_STATUS: "SUBMITTED_UNVERIFIED",
  looksLikePossiblySubmittedTimeout: () => false,
  looksLikePostConfirmTimeout: () => false,
  looksLikeNoServiceLinesFailure: (m: string) => /no service line/i.test(String(m ?? "")),
}));

vi.mock("@/lib/robotFleet.server", () => ({
  pollBaseUrlFor: (t: any) => t?.robot_worker_url ?? "https://robot.test",
}));

import {
  CORRECTED_AMBIGUOUS_CODE,
  CORRECTED_JOB_LOST_CODE,
  CORRECTED_JOB_LOST_MARKER,
  CORRECTED_ORIGINAL_REUSE_CODE,
  classifyCorrectedJob,
  correctedLostJobStep,
  isCorrectedRecord,
  robotPassFor,
  shouldBypassOriginalClaimShortCircuit,
} from "@/lib/correctedJob";
import {
  recoverCorrectedInFlight,
  reconcileCorrectedRobotJob,
} from "@/lib/correctedReconcile.server";
import { reconcileRobotJob } from "@/lib/robotReconcile.server";
import { hasPortalClaimEvidence } from "@/lib/submissionQueue.server";
import { needsFixSummary } from "@/lib/needsFixCategory";

/* ------------------------------------------------------------------ */
/* Minimal chainable fake of the supabase client                       */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;
type Filter = ["eq" | "is" | "in", string, any];

function makeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; patch: Row; matched: number }> = [];
  const inserts: Array<{ table: string; row: Row }> = [];

  function from(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "update" = "select";
    let patch: Row | null = null;

    const matches = (r: Row) =>
      filters.every(([op, c, v]) =>
        op === "in" ? (v as any[]).includes(r[c]) : op === "is" ? (r[c] ?? null) === v : r[c] === v,
      );

    function run() {
      const list = (tables[table] ??= []);
      const hit = list.filter(matches);
      if (mode === "update") {
        for (const r of hit) Object.assign(r, patch);
        writes.push({ table, patch: patch ?? {}, matched: hit.length });
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    }

    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => (filters.push(["eq", c, v]), b),
      is: (c: string, v: any) => (filters.push(["is", c, v]), b),
      in: (c: string, v: any[]) => (filters.push(["in", c, v]), b),
      order: () => b,
      limit: () => b,
      update: (p: Row) => {
        mode = "update";
        patch = p;
        return b;
      },
      insert: (row: Row) => {
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }

  return { supabase: { from }, writes, inserts, tables };
}

/* ------------------------------------------------------------------ */
/* Production-shaped fixture (trip 879cb071 / claim 9426224001318)     */
/* ------------------------------------------------------------------ */

const ORIGINAL_CLAIM = "9426224001318";
const CORRECTED_JOB = "trip-879cb071-a999-4538-8037-346fdf1ed92a-full-1788214594499-1788214598189";

function fixture(over: { correctedStatus?: string; failureReason?: string | null; updatedAt?: string } = {}) {
  // The SHARED trip still carries the original denied claim's evidence.
  const trip: Row = {
    id: "trip-1",
    robot_job_id: CORRECTED_JOB,
    robot_worker_id: "worker-2",
    robot_worker_url: "https://worker-2.test",
    robot_pass: "submit",
    robot_last_status: "SUBMITTED",
    robot_last_message: null,
    robot_last_checked_at: null,
    robot_job_started_at: "2026-08-31T22:16:38.237Z",
    robot_confirmation_number: ORIGINAL_CLAIM,
    submitted_confirmation: ORIGINAL_CLAIM,
    portal_confirmation: ORIGINAL_CLAIM,
    status: "submitted",
    portal_status: "denied",
  };

  const originalRecord: Row = {
    id: "orig-1",
    trip_id: "trip-1",
    company_id: "co-1",
    resubmission_id: null,
    status: "denied",
    state_confirmation_number: ORIGINAL_CLAIM,
    denial_reason: "Duplicate service line",
    billed_amount: 128.5,
    medicaid_trips: trip,
  };

  const correctedRecord: Row = {
    id: "corr-1",
    trip_id: "trip-1",
    company_id: "co-1",
    resubmission_id: "res-1",
    status: over.correctedStatus ?? "submitting",
    state_confirmation_number: null,
    requires_human_step: false,
    medicaid_trips: trip,
  };

  const draft: Row = {
    id: "res-1",
    company_id: "co-1",
    status: "processing",
    original_trip_id: "trip-1",
    original_claim_number: ORIGINAL_CLAIM,
    original_status: "denied",
    original_denial_reason: "Duplicate service line",
    resubmission_claim_number: null,
    failure_reason: over.failureReason ?? null,
    updated_at: over.updatedAt ?? "2026-08-31T22:16:38.237Z",
  };

  const db = makeDb({
    billing_records: [correctedRecord, originalRecord],
    claim_resubmissions: [draft],
    medicaid_trips: [trip],
    claim_resubmission_events: [],
    billing_audit_log: [],
  });

  return { ...db, trip, originalRecord, correctedRecord, draft };
}

function mockJobStatus(status: number, body: any) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  logAudit.mockClear();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* 1. The corrected job is polled, the original claim is not returned  */
/* ------------------------------------------------------------------ */

describe("a corrected claim polls its OWN job, never the original claim", () => {
  it("does not early-return the original denied claim number", async () => {
    const f = fixture();
    const fetchMock = mockJobStatus(200, { status: "running" });

    const out = await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(CORRECTED_JOB);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("https://worker-2.test");
    expect(out.pending).toBe(true);
    expect(out.message ?? "").not.toContain(ORIGINAL_CLAIM);
    expect(out.status).not.toBe("submitted");
  });

  it("polls the sticky worker that accepted the job", async () => {
    const f = fixture();
    const fetchMock = mockJobStatus(200, { status: "running" });
    await reconcileCorrectedRobotJob(f.supabase as any, {
      record: f.correctedRecord as any,
      trip: f.trip,
      actorId: null,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://worker-2.test/job-status/${encodeURIComponent(CORRECTED_JOB)}`,
    );
  });

  it("writes nothing at all while the job is still running", async () => {
    const f = fixture();
    mockJobStatus(200, { status: "running" });
    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    expect(f.writes).toEqual([]);
  });

  it("the pure rule keys off resubmission_id, not robot_pass", () => {
    expect(isCorrectedRecord({ resubmission_id: "res-1" })).toBe(true);
    expect(isCorrectedRecord({ resubmission_id: null })).toBe(false);
    expect(shouldBypassOriginalClaimShortCircuit({ resubmission_id: "res-1" })).toBe(true);
    // The 14 already-dispatched rows carry robot_pass "submit" and must recover.
    expect(shouldBypassOriginalClaimShortCircuit({ resubmission_id: "res-1" })).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. A NEW claim number updates the corrected rows only               */
/* ------------------------------------------------------------------ */

describe("a NEW claim number settles the corrected claim only", () => {
  it("writes the new number to the corrected bill and the corrected draft", async () => {
    const f = fixture();
    mockJobStatus(200, {
      status: "done",
      result: { status: "SUBMITTED", claim_id: "9426244002001" },
    });

    const out = await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");

    expect(out.pending).toBe(false);
    expect(out.confirmation_number).toBe("9426244002001");

    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("submitted");
    expect(rec.state_confirmation_number).toBe("9426244002001");
    expect(rec.requires_human_step).toBe(false);
    expect(rec.status_check_next_at).toBeTruthy();

    const draft = f.tables["claim_resubmissions"]![0]!;
    expect(draft.status).toBe("submitted");
    expect(draft.resubmission_claim_number).toBe("9426244002001");
    expect(draft.failure_reason).toBeNull();
  });

  it("never touches the shared trip or the original denied bill", async () => {
    const f = fixture();
    const tripBefore = JSON.stringify(f.trip);
    const originalBefore = JSON.stringify({ ...f.originalRecord, medicaid_trips: undefined });
    mockJobStatus(200, {
      status: "done",
      result: { status: "SUBMITTED", claim_id: "9426244002001" },
    });

    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");

    expect(JSON.stringify(f.trip)).toBe(tripBefore);
    expect(JSON.stringify({ ...f.originalRecord, medicaid_trips: undefined })).toBe(originalBefore);
    expect(f.writes.some((w) => w.table === "medicaid_trips")).toBe(false);
    expect(f.writes.filter((w) => w.table === "billing_records").every((w) => w.matched === 1)).toBe(
      true,
    );
  });

  it("records an audit trail on the corrected claim", async () => {
    const f = fixture();
    mockJobStatus(200, {
      status: "done",
      result: { status: "SUBMITTED", claim_id: "9426244002001" },
    });
    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    expect(logAudit).toHaveBeenCalled();
    expect(f.inserts.some((i) => i.table === "claim_resubmission_events")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The ORIGINAL claim number is held, never "submitted"             */
/* ------------------------------------------------------------------ */

describe("the ORIGINAL claim number coming back is never success", () => {
  it("holds the correction for manual HCPF verification", async () => {
    const f = fixture();
    mockJobStatus(200, {
      status: "done",
      result: { status: "SUBMITTED", claim_id: ORIGINAL_CLAIM },
    });

    const out = await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");

    expect(out.status).toBe("CORRECTED_ORIGINAL_CLAIM_REUSED");
    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("needs_fix");
    expect(rec.state_confirmation_number ?? null).toBeNull();
    expect(rec.requires_human_step).toBe(true);
    expect(rec.failure_code).toBe(CORRECTED_ORIGINAL_REUSE_CODE);
    // Never scheduled for another attempt.
    expect(rec.submit_next_attempt_at ?? null).toBeNull();
  });

  it("leaves the corrected draft in processing — out of Ready to Submit", async () => {
    const f = fixture();
    mockJobStatus(200, {
      status: "done",
      result: { status: "SUBMITTED", claim_id: ORIGINAL_CLAIM },
    });
    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    const draft = f.tables["claim_resubmissions"]![0]!;
    expect(draft.status).toBe("processing");
    expect(draft.resubmission_claim_number ?? null).toBeNull();
  });

  it("an accepted run with no claim number is also a hold, not a submission", async () => {
    const f = fixture();
    mockJobStatus(200, { status: "done", result: { status: "SUBMITTED" } });
    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("needs_fix");
    expect(rec.failure_code).toBe(CORRECTED_AMBIGUOUS_CODE);
    expect(rec.state_confirmation_number ?? null).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Lost / ambiguous jobs are held, never resent                     */
/* ------------------------------------------------------------------ */

describe("a lost or ambiguous corrected job is held, never resent", () => {
  it("a first 404 only marks the draft and keeps waiting", async () => {
    const f = fixture();
    mockJobStatus(404, "Not Found");
    const out = await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    expect(out.pending).toBe(true);
    const draft = f.tables["claim_resubmissions"]![0]!;
    expect(String(draft.failure_reason)).toContain(CORRECTED_JOB_LOST_MARKER);
    expect(draft.status).toBe("processing");
    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("submitting");
  });

  it("after the confirmation window it becomes a verification hold", async () => {
    const f = fixture({
      failureReason: `${CORRECTED_JOB_LOST_MARKER} waiting`,
      updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    mockJobStatus(404, "Not Found");
    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("needs_fix");
    expect(rec.failure_code).toBe(CORRECTED_JOB_LOST_CODE);
    expect(rec.requires_human_step).toBe(true);
    expect(f.writes.some((w) => w.table === "medicaid_trips")).toBe(false);
  });

  it("a transient poll failure changes nothing", async () => {
    const f = fixture();
    mockJobStatus(502, "bad gateway");
    const out = await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    expect(out.pending).toBe(true);
    expect(f.writes).toEqual([]);
  });

  it("the lost-job window is a mark -> wait -> verify sequence", () => {
    expect(correctedLostJobStep({ failureReason: null, markedAt: null })).toBe("mark");
    expect(
      correctedLostJobStep({
        failureReason: `${CORRECTED_JOB_LOST_MARKER} x`,
        markedAt: new Date().toISOString(),
      }),
    ).toBe("wait");
    expect(
      correctedLostJobStep({
        failureReason: `${CORRECTED_JOB_LOST_MARKER} x`,
        markedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    ).toBe("verify");
  });
});

/* ------------------------------------------------------------------ */
/* 5. Proven pre-Submit failure returns the draft to Ready             */
/* ------------------------------------------------------------------ */

describe("a PROVEN pre-Submit failure returns the correction to Ready", () => {
  it("re-opens the draft and leaves the bill re-queueable", async () => {
    const f = fixture();
    mockJobStatus(200, {
      status: "error",
      result: { status: "ERROR", reason: "no service line was committed" },
    });

    const out = await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");

    expect(out.pending).toBe(false);
    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("pending_submit");
    expect(rec.requires_human_step).toBe(false);
    const draft = f.tables["claim_resubmissions"]![0]!;
    expect(draft.status).toBe("queued");
    expect(f.writes.some((w) => w.table === "medicaid_trips")).toBe(false);
  });

  it("an ambiguous timeout is NOT returned to Ready", async () => {
    const f = fixture();
    mockJobStatus(200, {
      status: "error",
      result: { status: "ERROR", reason: "Job timed out after 480s" },
    });
    await reconcileRobotJob(f.supabase as any, "corr-1", "user-1");
    const draft = f.tables["claim_resubmissions"]![0]!;
    expect(draft.status).toBe("processing");
    const rec = f.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(rec.status).toBe("needs_fix");
    expect(rec.failure_code).toBe(CORRECTED_AMBIGUOUS_CODE);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Batch recovery never dispatches a new job                        */
/* ------------------------------------------------------------------ */

describe("recovery of the already-dispatched batch never sends anything", () => {
  function batch(n: number) {
    const billing: Row[] = [];
    const drafts: Row[] = [];
    for (let i = 0; i < n; i++) {
      const trip: Row = {
        id: `trip-${i}`,
        robot_job_id: `job-${i}`,
        robot_worker_url: "https://worker-1.test",
        robot_last_status: "SUBMITTED",
        robot_confirmation_number: `orig-${i}`,
        submitted_confirmation: `orig-${i}`,
        robot_job_started_at: "2026-08-31T22:16:38.000Z",
        status: "submitted",
      };
      billing.push({
        id: `corr-${i}`,
        trip_id: `trip-${i}`,
        company_id: "co-1",
        // Half of them were already wrongly pushed into Needs Fix.
        status: i % 2 === 0 ? "submitting" : "needs_fix",
        resubmission_id: `res-${i}`,
        state_confirmation_number: null,
        medicaid_trips: trip,
      });
      drafts.push({
        id: `res-${i}`,
        company_id: "co-1",
        status: "processing",
        original_trip_id: `trip-${i}`,
        original_claim_number: `orig-${i}`,
        failure_reason: null,
        updated_at: "2026-08-31T22:16:38.000Z",
      });
    }
    return makeDb({
      billing_records: billing,
      claim_resubmissions: drafts,
      claim_resubmission_events: [],
    });
  }

  it("polls all 14 corrected jobs read-only and issues no POST", async () => {
    const db = batch(14);
    const fetchMock = mockJobStatus(200, { status: "running" });

    const out = await recoverCorrectedInFlight(db.supabase as any, { companyId: "co-1" });

    expect(out.checked).toBe(14);
    expect(fetchMock).toHaveBeenCalledTimes(14);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain("/job-status/");
      const init: any = (call as any)[1] ?? {};
      expect(String(init.method ?? "GET").toUpperCase()).toBe("GET");
    }
    expect(db.writes).toEqual([]);
  });

  it("recovers corrected rows an older build already pushed into Needs Fix", async () => {
    const db = batch(2);
    mockJobStatus(200, { status: "done", result: { status: "SUBMITTED", claim_id: "NEW-1" } });
    await recoverCorrectedInFlight(db.supabase as any, {});
    const stuck = db.tables["billing_records"]!.find((r) => r.id === "corr-1")!;
    expect(stuck.status).toBe("submitted");
    expect(stuck.state_confirmation_number).toBe("NEW-1");
  });

  it("skips corrected claims that already hold a confirmation number", async () => {
    const db = batch(1);
    db.tables["billing_records"]![0]!.state_confirmation_number = "ALREADY";
    const fetchMock = mockJobStatus(200, { status: "running" });
    const out = await recoverCorrectedInFlight(db.supabase as any, {});
    expect(out.checked).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 7. Pure rules                                                       */
/* ------------------------------------------------------------------ */

describe("pure corrected-job rules", () => {
  it("a corrected run is always recorded as robot_pass=resubmit", () => {
    expect(robotPassFor({ doesSubmit: true, resubmissionId: "res-1" })).toBe("resubmit");
    expect(robotPassFor({ doesSubmit: false, resubmissionId: "res-1" })).toBe("resubmit");
    expect(robotPassFor({ doesSubmit: true, resubmissionId: null })).toBe("submit");
    expect(robotPassFor({ doesSubmit: false, resubmissionId: null })).toBe("capture");
  });

  it("classifies the original claim number as a hold and a new one as success", () => {
    const reuse = classifyCorrectedJob({
      httpStatus: 200,
      body: { status: "done", result: { status: "SUBMITTED", claim_id: ORIGINAL_CLAIM } },
      originalClaimNumber: ORIGINAL_CLAIM,
    });
    expect(reuse.kind).toBe("original_reuse");
    expect(reuse.hold).toBe(true);
    expect(reuse.claimNumber).toBeNull();

    const fresh = classifyCorrectedJob({
      httpStatus: 200,
      body: { status: "done", result: { status: "SUBMITTED", claim_id: "9426244002001" } },
      originalClaimNumber: ORIGINAL_CLAIM,
    });
    expect(fresh.kind).toBe("new_claim");
    expect(fresh.claimNumber).toBe("9426244002001");
  });

  it("never releases an outcome that might have reached Submit", () => {
    const d = classifyCorrectedJob({
      httpStatus: 200,
      body: {
        status: "error",
        result: {
          status: "ERROR",
          reason: "clicked Submit, click action done, Timeout 30000ms exceeded",
        },
      },
      originalClaimNumber: ORIGINAL_CLAIM,
    });
    expect(d.releaseToReady).toBe(false);
    expect(d.hold).toBe(true);
  });

  it("the shared trip's original claim is not evidence about the correction", () => {
    const original = {
      resubmission_id: null,
      state_confirmation_number: null,
      medicaid_trips: { robot_confirmation_number: ORIGINAL_CLAIM },
    };
    const corrected = {
      resubmission_id: "res-1",
      state_confirmation_number: null,
      medicaid_trips: { robot_confirmation_number: ORIGINAL_CLAIM, status: "submitted" },
    };
    expect(hasPortalClaimEvidence(original)).toBe(true);
    expect(hasPortalClaimEvidence(corrected)).toBe(false);
    expect(
      hasPortalClaimEvidence({ ...corrected, state_confirmation_number: "NEW-1" }),
    ).toBe(true);
  });

  it("the UI explains a corrected hold instead of claiming it was submitted", () => {
    const reuse = needsFixSummary({
      status: "needs_fix",
      resubmission_id: "res-1",
      requires_human_step: true,
      robot_confirmation_number: ORIGINAL_CLAIM,
      failure_code: CORRECTED_ORIGINAL_REUSE_CODE,
    });
    expect(reuse.category).toBe("unverified");
    expect(reuse.label).toMatch(/original number/i);
    expect(reuse.editable).toBe(false);

    const lost = needsFixSummary({
      status: "needs_fix",
      resubmission_id: "res-1",
      requires_human_step: true,
      failure_code: CORRECTED_JOB_LOST_CODE,
    });
    expect(lost.category).toBe("unverified");
    expect(lost.label).toMatch(/HCPF verification/i);
  });
});
