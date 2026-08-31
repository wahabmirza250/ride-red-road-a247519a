import { describe, expect, it } from "vitest";
import { dateKey, decideAutoFinalize, memberKey } from "@/lib/sweepAutoFinalize";
import { canQueueDraft } from "@/lib/resubmissionDraft";
import { runSaveAndQueue } from "@/lib/resubmissionSaveQueue";

const claim = (over: Record<string, any> = {}) => ({
  claim_id: "2326232001459",
  status: "Paid",
  service_date: "08/06/2026",
  paid_amount: 41.5,
  charge_amount: 60,
  units: 1,
  member_id: "P123456",
  linked: null,
  ...over,
});

const row = (over: Record<string, any> = {}) =>
  ({
    id: "r1",
    billing_record_id: "b1",
    company_id: "co-1",
    member_id: "P123456",
    service_date: "08/06/2026",
    outcome: "single",
    candidates: [claim()],
    confirmed_at: null,
    ...over,
  }) as any;

describe("safe single-match auto-finalization", () => {
  it("finalizes a Paid single match", () => {
    const d = decideAutoFinalize(row());
    expect(d).toMatchObject({ ok: true, status: "paid" });
  });

  it("finalizes a Denied single match", () => {
    const d = decideAutoFinalize(row({ candidates: [claim({ status: "Finalized Denial" })] }));
    expect(d).toMatchObject({ ok: true, status: "denied" });
  });

  it("refuses a claim id already used by another bill", () => {
    const d = decideAutoFinalize(
      row({ candidates: [claim({ linked: { billing_record_id: "other" } })] }),
    );
    expect(d).toEqual({ ok: false, reason: "That claim already belongs to another bill." });
  });

  it("refuses a candidate from another company", () => {
    const d = decideAutoFinalize(row({ company_id: "co-2" }), { companyId: "co-1" });
    expect(d.ok).toBe(false);
  });

  it("refuses a member ID mismatch", () => {
    const d = decideAutoFinalize(row({ candidates: [claim({ member_id: "P999999" })] }));
    expect(d).toMatchObject({ ok: false });
  });

  it("refuses a service date mismatch", () => {
    const d = decideAutoFinalize(row({ candidates: [claim({ service_date: "08/07/2026" })] }));
    expect(d).toMatchObject({ ok: false });
  });

  it("refuses a non-final portal status", () => {
    const d = decideAutoFinalize(row({ candidates: [claim({ status: "In process" })] }));
    expect(d.ok).toBe(false);
  });

  it("never touches multiple or none rows", () => {
    expect(decideAutoFinalize(row({ outcome: "multiple" })).ok).toBe(false);
    expect(decideAutoFinalize(row({ outcome: "none", candidates: [] })).ok).toBe(false);
    expect(decideAutoFinalize(row({ outcome: "error", candidates: [] })).ok).toBe(false);
  });

  it("is idempotent: an already confirmed row is skipped", () => {
    expect(decideAutoFinalize(row({ confirmed_at: "2026-08-31T00:00:00Z" })).ok).toBe(false);
  });

  it("normalizes member ids and dates before comparing", () => {
    expect(memberKey("p123-456")).toBe(P_KEY);
    expect(dateKey("2026-08-06")).toBe(dateKey("8/6/2026"));
  });
});

const P_KEY = "P123456";

/* ------------------------------------------------------------------ */
/* The repaired 15: status `queued` (Ready to Submit) must stay editable. */

describe("a Ready-to-Submit corrected claim can still be corrected and re-confirmed", () => {
  const snapshot = {
    service_date: "2026-08-06",
    lines: [{ line_index: 1, service_date: "2026-08-06" }],
  } as any;

  it("the queue gate accepts draft and queued, and refuses processing", () => {
    expect(canQueueDraft({ status: "draft" }, snapshot, true).ok).toBe(true);
    expect(canQueueDraft({ status: "queued" }, snapshot, true).ok).toBe(true);
    expect(canQueueDraft({ status: "processing" }, snapshot, true).ok).toBe(false);
    expect(canQueueDraft({ status: "submitted" }, snapshot, true).ok).toBe(false);
  });

  it("save-then-queue succeeds for a repaired queued draft", async () => {
    const calls: string[] = [];
    const res = await runSaveAndQueue(
      {
        load: async () => ({ status: "queued", draft_version: 3 }),
        validate: () => ({ ok: true, issues: [] }),
        persist: async () => (calls.push("persist"), 4),
        readBack: async () => ({
          draft_snapshot: { service_date: "2026-08-06" },
          draft_version: 4,
          lines: [{ line_index: 1, service_date: "2026-08-06" }],
        }),
        audit: async (a) => void calls.push(a),
        queue: async () => ({ queued: true, trip_id: "trip-1", idempotency_key: "k|v2" }),
      },
      { snapshot, confirm: true, expected_version: 3 },
    );
    expect(res.kind).toBe("queued");
    expect(calls).toContain("draft_queued");
  });

  it("a copy already handed to a worker is still refused", async () => {
    const res = await runSaveAndQueue(
      {
        load: async () => ({ status: "processing", draft_version: 3 }),
        validate: () => ({ ok: true, issues: [] }),
        persist: async () => 4,
        readBack: async () => null,
        audit: async () => {},
        queue: async () => ({ queued: true }),
      },
      { snapshot, confirm: true },
    );
    expect(res.kind).toBe("conflict");
  });

  it("the exact server error is surfaced, never a generic message", async () => {
    const res = await runSaveAndQueue(
      {
        load: async () => ({ status: "queued", draft_version: 1 }),
        validate: () => ({ ok: true, issues: [] }),
        persist: async () => 2,
        readBack: async () => ({
          draft_snapshot: { service_date: "2026-08-06" },
          draft_version: 2,
          lines: [{ line_index: 1, service_date: "2026-08-06" }],
        }),
        audit: async () => {},
        queue: async () => {
          throw new Error("duplicate key value violates unique constraint");
        },
      },
      { snapshot, confirm: true },
    );
    expect(res).toMatchObject({ kind: "saved_not_queued" });
    expect((res as any).reason).toContain("duplicate key value");
  });
});
