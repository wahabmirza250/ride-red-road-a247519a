import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyResubmissionOutcome,
  classifyPortalFinancialStatus,
  canRetryResubmission,
  isOriginalClaimReuse,
  ACTIVE_RESUBMISSION_STATUSES,
  READY_RESUBMISSION_STATUS,
} from "@/lib/resubmissionLifecycle";
import {
  claimResubmissionsForSubmit,
  releaseResubmissionToReady,
  reconcileResubmissionForRecord,
} from "@/lib/resubmissionLifecycle.server";

/**
 * Minimal in-memory stand-in for the parts of PostgREST we use: conditional
 * single-row UPDATE ... WHERE status = ? RETURNING id, plus event inserts.
 */
function makeDb(rows: any[], opts: { failEvents?: boolean } = {}) {
  const events: any[] = [];
  const table = (name: string) => {
    if (name === "claim_resubmission_events") {
      return {
        insert: async (v: any) => {
          if (opts.failEvents) return { error: { message: "audit down" } };
          events.push(v);
          return { error: null };
        },
      };
    }
    const state: any = { filters: [], patch: null, mode: "select" };
    const api: any = {
      update(patch: any) {
        state.mode = "update";
        state.patch = patch;
        return api;
      },
      select() {
        return state.mode === "update" ? run() : api;
      },
      eq(col: string, val: any) {
        state.filters.push([col, val]);
        return api;
      },
      in(col: string, vals: any[]) {
        state.filters.push([col, vals]);
        return api;
      },
      limit() {
        return run();
      },
      maybeSingle() {
        return run();
      },
    };
    function match(r: any) {
      return state.filters.every(([c, v]: any) =>
        Array.isArray(v) ? v.includes(r[c]) : r[c] === v,
      );
    }
    async function run() {
      const hits = rows.filter(match);
      if (state.mode === "update") {
        for (const h of hits) Object.assign(h, state.patch);
        return { data: hits.map((h) => ({ ...h })), error: null };
      }
      return { data: hits.map((h) => ({ ...h })), error: null };
    }
    return api;
  };
  return { from: table, __events: events, __rows: rows };
}

const ROW = () => ({
  id: "rs1",
  company_id: "co1",
  status: "queued",
  idempotency_key: "acct|trip|2026-07-30|v1",
  original_claim_number: "ORIG-111",
  original_trip_id: "t1",
  submission_billing_record_id: null,
});

describe("corrected resubmission state machine", () => {
  it("keeps draft, queued and processing under the one-live-per-trip rule", () => {
    expect(ACTIVE_RESUBMISSION_STATUSES).toEqual(["draft", "queued", "processing"]);
    expect(READY_RESUBMISSION_STATUS).toBe("queued");
  });

  it("queued selected -> processing, so it disappears from Ready", async () => {
    const db = makeDb([ROW()]);
    const res = await claimResubmissionsForSubmit(db, "user1", [ROW()]);
    expect(res.claimed).toEqual(["rs1"]);
    expect(db.__rows[0].status).toBe("processing");
    expect(db.__rows[0].claimed_by).toBe("user1");
  });

  it("double click / second browser claims zero rows the second time", async () => {
    const db = makeDb([ROW()]);
    const a = await claimResubmissionsForSubmit(db, "user1", [ROW()]);
    const b = await claimResubmissionsForSubmit(db, "user2", [ROW()]);
    expect(a.claimed).toHaveLength(1);
    expect(b.claimed).toHaveLength(0);
    expect(b.rejected[0].reason).toMatch(/already taken/i);
  });

  it("a wrong idempotency key never claims the row", async () => {
    const db = makeDb([ROW()]);
    const res = await claimResubmissionsForSubmit(db, "u", [
      { ...ROW(), idempotency_key: "stale-key" },
    ]);
    expect(res.claimed).toHaveLength(0);
    expect(db.__rows[0].status).toBe("queued");
  });

  it("a silent audit failure blocks the send and returns the row to Ready", async () => {
    const db = makeDb([ROW()], { failEvents: true });
    const res = await claimResubmissionsForSubmit(db, "u", [ROW()]);
    expect(res.claimed).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/audit/i);
    expect(db.__rows[0].status).toBe("queued");
  });

  it("proven enqueue failure returns processing -> queued only", async () => {
    const db = makeDb([{ ...ROW(), status: "processing" }]);
    expect(await releaseResubmissionToReady(db, "rs1", "preflight failed")).toBe(true);
    expect(db.__rows[0].status).toBe("queued");
    // A row that is not processing is never touched.
    expect(await releaseResubmissionToReady(db, "rs1", "again")).toBe(false);
  });

  it("uncertain outcome keeps the row out of Ready and never retries", async () => {
    const db = makeDb([{ ...ROW(), status: "processing", submission_billing_record_id: "b1" }]);
    const out = await reconcileResubmissionForRecord(db, {
      recordId: "b1",
      actorId: "u",
      outcome: { pending: false, status: "TIMEOUT", message: "no response", billingStatus: "needs_fix" },
    });
    expect(out.changed).toBe(false);
    expect(db.__rows[0].status).toBe("processing");
  });

  it("confirmed success -> submitted with the NEW claim id", async () => {
    const db = makeDb([{ ...ROW(), status: "processing", submission_billing_record_id: "b1" }]);
    const out = await reconcileResubmissionForRecord(db, {
      recordId: "b1",
      actorId: "u",
      outcome: {
        pending: false,
        status: "SUBMITTED",
        confirmation_number: "NEW-999",
        billingStatus: "submitted",
      },
    });
    expect(out).toMatchObject({ changed: true, next: "submitted" });
    expect(db.__rows[0].status).toBe("submitted");
    expect(db.__rows[0].resubmission_claim_number).toBe("NEW-999");
  });

  it("the original claim id can never become the resubmission claim id", async () => {
    expect(isOriginalClaimReuse("ORIG-111", "ORIG-111")).toBe(true);
    const db = makeDb([{ ...ROW(), status: "processing", submission_billing_record_id: "b1" }]);
    const out = await reconcileResubmissionForRecord(db, {
      recordId: "b1",
      outcome: {
        pending: false,
        confirmation_number: "ORIG-111",
        billingStatus: "submitted",
      },
    });
    expect(out.changed).toBe(false);
    expect(db.__rows[0].status).toBe("processing");
    expect(db.__rows[0].resubmission_claim_number).toBeUndefined();
  });

  it("definitive 'nothing was sent' -> failed, with an owner retry", async () => {
    const db = makeDb([{ ...ROW(), status: "processing", submission_billing_record_id: "b1" }]);
    const out = await reconcileResubmissionForRecord(db, {
      recordId: "b1",
      outcome: {
        pending: false,
        status: "STOPPED_BEFORE_SUBMIT",
        message: "The robot stopped before clicking Submit. No claim was created.",
        billingStatus: "needs_fix",
      },
    });
    expect(out).toMatchObject({ changed: true, next: "failed" });
    expect(canRetryResubmission(db.__rows[0].status)).toBe(true);
    expect(canRetryResubmission("processing")).toBe(false);
  });

  it("paid / denied reconciliation only from submitted", () => {
    expect(classifyPortalFinancialStatus("submitted", "paid")).toBe("paid");
    expect(classifyPortalFinancialStatus("submitted", "denied")).toBe("denied");
    expect(classifyPortalFinancialStatus("processing", "paid")).toBe(null);
    expect(classifyPortalFinancialStatus("submitted", "pending")).toBe(null);
  });

  it("a still-running job changes nothing", () => {
    expect(classifyResubmissionOutcome({ pending: true }).next).toBe(null);
  });
});
