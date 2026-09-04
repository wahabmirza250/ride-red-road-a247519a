/**
 * SAFETY RULES FOR ATTACHING A PORTAL CONFIRMATION TO A BILL.
 *
 * Every test here exists because getting it wrong either loses real money
 * (a paid claim left unreconciled forever) or creates a duplicate claim.
 */
import { describe, expect, it } from "vitest";
import { isPortalClaimNumber, pickConfirmationNumber } from "@/lib/claimConfirmation";
import {
  CONFIRMATION_RECONCILED_ACTION,
  decideConfirmationReconcile,
  findPortalMatchEvidence,
  findRobotSubmittedEvidence,
} from "@/lib/confirmationReconcile";
import { pickCorrectedMatch } from "@/lib/correctedVerify";
import type { PortalClaim } from "@/lib/hcpfSearch";

const CLAIM = "2326241001170";

const audits = (extra: any[] = []) => [
  {
    action: "robot_submitted",
    notes: `Confirmation #${CLAIM}`,
    created_at: "2026-08-30T10:00:00Z",
  },
  ...extra,
];

const portalRead = {
  action: "hcpf_auto_search",
  notes: `Read-only HCPF search for member P1 on 07/30/2026 returned 1 claim(s): ${CLAIM}. Nothing was submitted or queued.`,
  created_at: "2026-08-30T11:00:00Z",
};

const trip = {
  portal_confirmation: CLAIM,
  submitted_confirmation: CLAIM,
  robot_confirmation_number: CLAIM,
  robot_last_status: "SUBMITTED",
};

const record = {
  id: "b1",
  status: "needs_fix",
  resubmission_id: null,
  state_confirmation_number: null,
};

const decide = (over: Partial<Parameters<typeof decideConfirmationReconcile>[0]> = {}) =>
  decideConfirmationReconcile({
    record,
    trip,
    audits: audits([portalRead]),
    claimUsedByOtherRecord: false,
    ...over,
  });

/* ------------------------------------------------------------------ */

describe("what counts as an HCPF claim number", () => {
  it("accepts exactly 13 digits and nothing else", () => {
    expect(isPortalClaimNumber(CLAIM)).toBe(true);
    expect(isPortalClaimNumber("23262410011")).toBe(false); // 11 digits
    expect(isPortalClaimNumber("23262410011701")).toBe(false); // 14 digits
    expect(isPortalClaimNumber("job-7f3a")).toBe(false);
    expect(isPortalClaimNumber(null)).toBe(false);
  });

  it("reads one agreed number off the trip", () => {
    const p = pickConfirmationNumber(trip);
    expect(p.ok && p.claimNumber).toBe(CLAIM);
  });

  it("refuses to guess when the trip carries two different numbers", () => {
    const p = pickConfirmationNumber({ ...trip, robot_confirmation_number: "2326241001999" });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/different claim numbers/i);
  });

  it("ignores junk in a confirmation column instead of attaching it", () => {
    const p = pickConfirmationNumber({
      portal_confirmation: "see portal",
      submitted_confirmation: null,
      robot_confirmation_number: null,
      state_confirmation_number: null,
    });
    expect(p.ok).toBe(false);
  });
});

describe("evidence lookup", () => {
  it("finds the submit line naming the exact claim", () => {
    expect(findRobotSubmittedEvidence(audits([portalRead]), CLAIM)).toBeTruthy();
    expect(findRobotSubmittedEvidence(audits([portalRead]), "2326241001999")).toBeNull();
  });

  it("only accepts a portal read that happened AFTER the submit", () => {
    const before = { ...portalRead, created_at: "2026-08-30T09:00:00Z" };
    expect(findPortalMatchEvidence([before], CLAIM, "2026-08-30T10:00:00Z")).toBeNull();
    expect(findPortalMatchEvidence([portalRead], CLAIM, "2026-08-30T10:00:00Z")).toBeTruthy();
  });

  it("does not treat a queue/recovery note as a portal read", () => {
    const recovery = {
      action: "submitting_quarantine_recovered",
      notes: `Confirmation #${CLAIM}`,
      created_at: "2026-08-30T12:00:00Z",
    };
    expect(findPortalMatchEvidence([recovery], CLAIM, "2026-08-30T10:00:00Z")).toBeNull();
  });
});

describe("the attach decision", () => {
  it("attaches a unique, proven, unused confirmation", () => {
    const d = decide();
    expect(d.kind).toBe("attach");
    if (d.kind === "attach") expect(d.claimNumber).toBe(CLAIM);
  });

  it("MISSING CONFIRMATION: nothing to attach, nothing written", () => {
    const d = decide({
      trip: {
        portal_confirmation: null,
        submitted_confirmation: null,
        robot_confirmation_number: null,
      },
    });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/no hcpf claim number/i);
  });

  it("DUPLICATE CLAIM: refuses a number another bill already owns", () => {
    const d = decide({ claimUsedByOtherRecord: true });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/already linked to another RedArt bill/i);
  });

  it("ORIGINAL-ID COLLISION: a corrected draft never inherits its trip's claim", () => {
    const d = decide({ record: { ...record, resubmission_id: "res-1" } });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/corrected resubmission draft/i);
  });

  it("ORIGINAL-ID COLLISION: never attaches the original denied claim number", () => {
    const d = decide({ originalClaimNumber: CLAIM });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/ORIGINAL denied claim/i);
  });

  it("refuses without a submit record naming that claim", () => {
    const d = decide({ audits: [portalRead] });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/no submission record/i);
  });

  it("refuses without a later read-only portal confirmation", () => {
    const d = decide({ audits: audits() });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/no later portal check/i);
  });

  it("REPEATED RECOVERY: a bill that already owns the claim is a no-op", () => {
    const d = decide({ record: { ...record, state_confirmation_number: CLAIM } });
    expect(d.kind).toBe("noop");
  });

  it("refuses when the bill and the trip disagree about the claim", () => {
    const d = decide({ record: { ...record, state_confirmation_number: "2326241001999" } });
    expect(d.kind).toBe("blocked");
    expect(d.reason).toMatch(/must resolve the difference/i);
  });
});

/* ---------------- server writer: atomic + idempotent ---------------- */

type Row = Record<string, any>;

function makeDb(bills: Row[], auditRows: Row[] = [], resubs: Row[] = []) {
  const writes: Row[] = [];
  const inserts: Row[] = [];

  const match = (row: Row, filters: any[][]) =>
    filters.every(([op, col, val]) => {
      const v = row[col] ?? null;
      if (op === "eq") return String(v) === String(val);
      if (op === "neq") return String(v) !== String(val);
      if (op === "is") return v === val;
      if (op === "in") return (val as any[]).map(String).includes(String(v));
      if (op === "gte") return String(v) >= String(val);
      return true;
    });

  function run(q: any): Row[] {
    const table =
      q.table === "billing_records" ? bills : q.table === "claim_resubmissions" ? resubs : auditRows;
    const hits = table.filter((r) => match(r, q.filters));
    if (q.op === "update") {
      for (const r of hits) Object.assign(r, q.payload);
      writes.push({ table: q.table, payload: q.payload, ids: hits.map((r) => r.id) });
      return hits;
    }
    if (q.op === "insert") {
      inserts.push({ table: q.table, payload: q.payload });
      (table as Row[]).push({ id: `a${table.length + 1}`, ...q.payload });
      return [];
    }
    return hits;
  }

  const builder = (table: string) => {
    const q: any = { table, op: "select", filters: [] as any[][], payload: null };
    const api: any = {
      select: () => api,
      update: (payload: Row) => {
        q.op = "update";
        q.payload = payload;
        return api;
      },
      insert: (payload: Row) => {
        q.op = "insert";
        q.payload = payload;
        run(q);
        return Promise.resolve({ data: null, error: null });
      },
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), api),
      neq: (c: string, v: unknown) => (q.filters.push(["neq", c, v]), api),
      is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), api),
      in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), api),
      gte: (c: string, v: unknown) => (q.filters.push(["gte", c, v]), api),
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: run(q)[0] ?? null, error: null }),
      single: async () => ({ data: run(q)[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: run(q), error: null }).then(res, rej),
    };
    return api;
  };

  return { supabase: { from: builder } as any, writes, inserts, bills, auditRows, resubs };
}

const billRow = (over: Row = {}): Row => ({
  id: "b1",
  status: "needs_fix",
  company_id: "c1",
  trip_id: "t1",
  resubmission_id: null,
  state_confirmation_number: null,
  submitted_at: null,
  medicaid_trips: { id: "t1", ...trip },
  claim_resubmissions: null,
  ...over,
});

describe("reconcileConfirmedSubmission (writer)", () => {
  it("UNIQUE SAFE CONFIRMATION: one atomic write, one audit line, no submission", async () => {
    const { reconcileConfirmedSubmission } = await import("@/lib/confirmationReconcile.server");
    const db = makeDb(
      [billRow()],
      audits([portalRead]).map((a) => ({ ...a, billing_record_id: "b1" })),
    );
    const out = await reconcileConfirmedSubmission(db.supabase, { recordId: "b1", actorId: null });

    expect(out.kind).toBe("attached");
    expect(out.claim_number).toBe(CLAIM);
    const bill = db.bills[0]!;
    expect(bill.status).toBe("submitted");
    expect(bill.state_confirmation_number).toBe(CLAIM);
    expect(bill.requires_human_step).toBe(false);
    expect(bill.failure_code).toBeNull();
    expect(bill.submission_error).toBeNull();
    expect(bill.status_check_next_at).toBeTruthy();
    // Nothing was queued, submitted or retried.
    expect(bill.submit_next_attempt_at).toBeNull();
    expect(JSON.stringify(db.writes)).not.toMatch(/"queued"|robot_job|submit_attempt/);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]!.payload.action).toBe(CONFIRMATION_RECONCILED_ACTION);
  });

  it("REPEATED RECOVERY: running it again writes nothing and logs nothing", async () => {
    const { reconcileConfirmedSubmission } = await import("@/lib/confirmationReconcile.server");
    const db = makeDb(
      [billRow()],
      audits([portalRead]).map((a) => ({ ...a, billing_record_id: "b1" })),
    );
    await reconcileConfirmedSubmission(db.supabase, { recordId: "b1", actorId: null });
    const writesAfterFirst = db.writes.length;
    const insertsAfterFirst = db.inserts.length;

    const again = await reconcileConfirmedSubmission(db.supabase, {
      recordId: "b1",
      actorId: null,
    });
    expect(again.kind).toBe("noop");
    expect(db.writes).toHaveLength(writesAfterFirst);
    expect(db.inserts).toHaveLength(insertsAfterFirst);
  });

  it("DUPLICATE CLAIM: refuses when another bill already owns the number", async () => {
    const { reconcileConfirmedSubmission } = await import("@/lib/confirmationReconcile.server");
    const other = billRow({ id: "b2", status: "submitted", state_confirmation_number: CLAIM });
    const db = makeDb(
      [billRow(), other],
      audits([portalRead]).map((a) => ({ ...a, billing_record_id: "b1" })),
    );
    const out = await reconcileConfirmedSubmission(db.supabase, { recordId: "b1", actorId: null });

    expect(out.kind).toBe("blocked");
    expect(db.bills[0]!.state_confirmation_number).toBeNull();
    expect(db.inserts).toHaveLength(0);
  });

  it("DUPLICATE CLAIM: refuses a number a corrected resubmission already owns", async () => {
    const { reconcileConfirmedSubmission } = await import("@/lib/confirmationReconcile.server");
    const db = makeDb(
      [billRow()],
      audits([portalRead]).map((a) => ({ ...a, billing_record_id: "b1" })),
      [{ id: "res-9", resubmission_claim_number: CLAIM }],
    );
    const out = await reconcileConfirmedSubmission(db.supabase, { recordId: "b1", actorId: null });
    expect(out.kind).toBe("blocked");
    expect(db.bills[0]!.state_confirmation_number).toBeNull();
    expect(db.inserts).toHaveLength(0);
  });

  it("MISSING CONFIRMATION: leaves the bill untouched and silent", async () => {
    const { reconcileConfirmedSubmission } = await import("@/lib/confirmationReconcile.server");
    const db = makeDb([
      billRow({
        medicaid_trips: {
          id: "t1",
          portal_confirmation: null,
          submitted_confirmation: null,
          robot_confirmation_number: null,
        },
      }),
    ]);
    const out = await reconcileConfirmedSubmission(db.supabase, { recordId: "b1", actorId: null });
    expect(out.kind).toBe("blocked");
    expect(db.writes).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });

  it("ORIGINAL-ID COLLISION: never touches a corrected draft", async () => {
    const { reconcileConfirmedSubmission } = await import("@/lib/confirmationReconcile.server");
    const db = makeDb([
      billRow({
        resubmission_id: "res-1",
        claim_resubmissions: { id: "res-1", original_claim_number: CLAIM },
      }),
    ]);
    const out = await reconcileConfirmedSubmission(db.supabase, { recordId: "b1", actorId: null });
    expect(out.kind).toBe("blocked");
    expect(out.reason).toMatch(/corrected resubmission draft/i);
    expect(db.writes).toHaveLength(0);
  });

  it("sweep skips bills with no candidate and never spams the audit log", async () => {
    const { reconcileConfirmedSubmissions } = await import("@/lib/confirmationReconcile.server");
    const db = makeDb([
      billRow({
        id: "b9",
        medicaid_trips: {
          id: "t9",
          portal_confirmation: null,
          submitted_confirmation: null,
          robot_confirmation_number: null,
        },
      }),
    ]);
    const out = await reconcileConfirmedSubmissions(db.supabase, {});
    expect(out.scanned).toBe(0);
    expect(out.attached).toBe(0);
    expect(db.inserts).toHaveLength(0);
  });
});

/* ---------------- corrected-claim portal search results -------------- */

const claim = (id: string, extra: Partial<PortalClaim> = {}): PortalClaim => ({
  claim_id: id,
  status: "PAID",
  service_date: "07/30/2026",
  paid_amount: 54.8,
  charge_amount: 104.12,
  units: 10,
  member_id: "P1",
  ...extra,
});

describe("corrected resubmission portal results", () => {
  it("NO RESULT: stays on Verification Hold", () => {
    const m = pickCorrectedMatch({ claims: [], originalClaimNumber: CLAIM });
    expect(m.kind).toBe("none");
  });

  it("MULTIPLE RESULTS: stays on hold and names every choice", () => {
    const m = pickCorrectedMatch({
      claims: [claim("2326241001991"), claim("2326241001992")],
      originalClaimNumber: CLAIM,
    });
    expect(m.kind).toBe("multiple");
    expect(m.reason).toContain("2326241001991");
    expect(m.reason).toContain("2326241001992");
  });

  it("ORIGINAL-ID COLLISION: the original denied claim is never a match", () => {
    expect(pickCorrectedMatch({ claims: [claim(CLAIM)], originalClaimNumber: CLAIM }).kind).toBe(
      "none",
    );
  });

  it("DUPLICATE CLAIM: a number used by ANY bill, in any company, is excluded", () => {
    const m = pickCorrectedMatch({
      claims: [claim("2326241001991")],
      originalClaimNumber: CLAIM,
      usedClaimNumbers: ["2326241001991"],
    });
    expect(m.kind).toBe("none");
  });

  it("one unused new claim is the only case that resolves automatically", () => {
    const m = pickCorrectedMatch({ claims: [claim("2326241001991")], originalClaimNumber: CLAIM });
    expect(m.kind).toBe("unique");
  });
});
