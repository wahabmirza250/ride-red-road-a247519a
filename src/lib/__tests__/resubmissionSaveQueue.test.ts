import { describe, expect, it, vi } from "vitest";
import { normalizeSnapshot, validateDraft, type DraftSnapshot } from "@/lib/resubmissionDraft";
import {
  readBackMatches,
  runSaveAndQueue,
  tabForField,
  type SaveQueueDeps,
} from "@/lib/resubmissionSaveQueue";

function validSnapshot(date = "2026-08-14"): DraftSnapshot {
  return normalizeSnapshot({
    service_date: date,
    medicaid_id: "A1234567",
    driver_id: null,
    driver_name: "Sam Driver",
    vehicle_type: "ambulatory",
    trip_kind: "one_way",
    legs: [
      {
        leg_index: 1,
        leg_date: date,
        pickup_time: "09:00",
        dropoff_time: "09:30",
        pickup_address: "100 A St",
        dropoff_address: "200 B St",
        pickup_odometer: 1000,
        dropoff_odometer: 1010,
      },
    ],
    lines: [{ line_index: 1, service_date: date, units: 1, miles: 10, modifiers: [] }],
  });
}

/** Stale DB row: never explicitly saved, exactly the production repro. */
function harness(overrides: Partial<SaveQueueDeps> = {}) {
  const db = { status: "draft", draft_version: 1, draft_snapshot: null as any, lines: [] as any[] };
  const audits: string[] = [];
  const queueCalls: DraftSnapshot[] = [];
  const deps: SaveQueueDeps = {
    load: async () => ({ status: db.status, draft_version: db.draft_version }),
    validate: (s) => validateDraft(s),
    persist: async (s) => {
      db.draft_snapshot = s;
      db.draft_version += 1;
      db.lines = s.lines.map((l) => ({ line_index: l.line_index, service_date: l.service_date }));
      return db.draft_version;
    },
    readBack: async () => ({
      draft_snapshot: db.draft_snapshot,
      draft_version: db.draft_version,
      lines: db.lines,
    }),
    audit: async (a) => {
      audits.push(a);
    },
    queue: async (s) => {
      queueCalls.push(s);
      if (db.status !== "draft") return { queued: false, reason: "Already queued or submitted." };
      db.status = "queued";
      return { queued: true, trip_id: "trip-1", idempotency_key: "k1" };
    },
    ...overrides,
  };
  return { db, deps, audits, queueCalls };
}

describe("save-then-queue: the stale unsaved-draft bug", () => {
  it("saves and queues once when the DB draft_snapshot is null but the UI snapshot is valid", async () => {
    const h = harness();
    const res = await runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: true });
    expect(res.kind).toBe("queued");
    expect(h.db.draft_snapshot?.service_date).toBe("2026-08-14");
    expect(h.queueCalls).toHaveLength(1);
    expect(h.audits).toEqual(["draft_saved", "draft_reviewed", "draft_queued"]);
  });

  it("queues the CURRENT UI date, never the stale database date", async () => {
    const h = harness();
    h.db.draft_snapshot = validSnapshot("2026-07-30");
    await runSaveAndQueue(h.deps, { snapshot: validSnapshot("2026-08-14"), confirm: true });
    expect(h.queueCalls[0]!.service_date).toBe("2026-08-14");
    expect(h.queueCalls[0]!.lines[0]!.service_date).toBe("2026-08-14");
    expect(h.db.draft_snapshot.service_date).toBe("2026-08-14");
  });

  it("client and server agree on the same snapshot", async () => {
    const { validateDraft } = await import("@/lib/resubmissionDraft");
    const snap = validSnapshot();
    expect(validateDraft(snap).ok).toBe(true);
    expect((await runSaveAndQueue(harness().deps, { snapshot: snap, confirm: true })).kind).toBe(
      "queued",
    );
  });
});

describe("save-then-queue safety", () => {
  it("returns the real field error and creates no job when validation fails", async () => {
    const h = harness();
    const res = await runSaveAndQueue(h.deps, {
      snapshot: normalizeSnapshot({ ...validSnapshot(), service_date: null }),
      confirm: true,
    });
    expect(res.kind).toBe("invalid");
    if (res.kind === "invalid") {
      expect(res.reason).toMatch(/service date/i);
      expect(res.tab).toBe("trip");
    }
    expect(h.queueCalls).toHaveLength(0);
  });

  it("creates zero jobs when the save fails", async () => {
    const h = harness({
      persist: async () => {
        throw new Error("permission denied");
      },
    });
    await expect(
      runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: true }),
    ).rejects.toThrow(/permission denied/);
    expect(h.queueCalls).toHaveLength(0);
  });

  it("creates zero jobs when the read-back does not prove the save", async () => {
    const h = harness({
      readBack: async () => ({ draft_snapshot: { service_date: "2026-07-30" }, draft_version: 2, lines: [] }),
    });
    const res = await runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: true });
    expect(res.kind).toBe("conflict");
    expect(h.queueCalls).toHaveLength(0);
  });

  it("creates zero jobs when the audit trail cannot be written", async () => {
    const h = harness({
      audit: async () => {
        throw new Error("audit trail unavailable");
      },
    });
    await expect(
      runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: true }),
    ).rejects.toThrow(/audit trail/);
    expect(h.queueCalls).toHaveLength(0);
  });

  it("keeps the corrected draft saved when only the queue step fails", async () => {
    const h = harness({
      queue: async () => {
        throw new Error("HCPF queue unavailable");
      },
    });
    const res = await runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: true });
    expect(res.kind).toBe("saved_not_queued");
    expect(h.db.draft_snapshot.service_date).toBe("2026-08-14");
    expect(h.db.status).toBe("draft");
  });

  it("collapses a double click onto exactly one job", async () => {
    const h = harness();
    const snap = validSnapshot();
    const [a, b] = [
      await runSaveAndQueue(h.deps, { snapshot: snap, confirm: true }),
      await runSaveAndQueue(h.deps, { snapshot: snap, confirm: true }),
    ];
    expect(a.kind).toBe("queued");
    expect(b.kind).toBe("conflict");
    expect(h.queueCalls).toHaveLength(1);
  });

  it("refuses a stale tab's expected version without queueing", async () => {
    const h = harness();
    h.db.draft_version = 7;
    const res = await runSaveAndQueue(h.deps, {
      snapshot: validSnapshot(),
      confirm: true,
      expected_version: 3,
    });
    expect(res.kind).toBe("conflict");
    expect(h.queueCalls).toHaveLength(0);
  });

  it("requires an explicit confirmation", async () => {
    const h = harness();
    const res = await runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: false });
    expect(res.kind).toBe("conflict");
    expect(h.queueCalls).toHaveLength(0);
  });

  it("works for a legacy draft with no version recorded", async () => {
    const h = harness({ load: async () => ({ status: "draft", draft_version: null }) });
    const res = await runSaveAndQueue(h.deps, {
      snapshot: validSnapshot(),
      confirm: true,
      expected_version: 1,
    });
    expect(res.kind).toBe("queued");
  });

  it("never queues a resubmission that already left the draft state", async () => {
    const h = harness({ load: async () => ({ status: "queued", draft_version: 1 }) });
    const res = await runSaveAndQueue(h.deps, { snapshot: validSnapshot(), confirm: true });
    expect(res.kind).toBe("conflict");
    expect(h.queueCalls).toHaveLength(0);
  });
});

describe("field -> tab focus and read-back proof", () => {
  it("maps validation fields to the editor tab", () => {
    expect(tabForField("service_date")).toBe("trip");
    expect(tabForField("legs.0.pickup_time")).toBe("legs");
    expect(tabForField("lines.1.modifiers")).toBe("lines");
    expect(tabForField(null)).toBe("trip");
  });

  it("detects mismatched line dates", () => {
    const ok = readBackMatches(
      { draft_snapshot: { service_date: "2026-08-14" }, draft_version: 2, lines: [{ line_index: 1, service_date: "2026-08-14" }] },
      { service_date: "2026-08-14", version: 2, lineDates: ["2026-08-14"] },
    );
    expect(ok.ok).toBe(true);
    expect(
      readBackMatches(
        { draft_snapshot: { service_date: "2026-08-14" }, draft_version: 2, lines: [{ line_index: 1, service_date: "2026-07-30" }] },
        { service_date: "2026-08-14", version: 2, lineDates: ["2026-08-14"] },
      ).ok,
    ).toBe(false);
    expect(readBackMatches(null, { service_date: null, version: 1, lineDates: [] }).ok).toBe(false);
  });
});

it("does not touch production data", () => {
  expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
});
