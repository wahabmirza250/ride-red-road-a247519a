import { describe, expect, it } from "vitest";
import {
  autoPilotStatusLabel,
  resolveAutoPilotDefault,
  shouldAutoPromote,
} from "@/lib/autoPilot";
import { splitIntoWaves } from "@/lib/submissionWaves";
import { promoteDueWaves, releaseNextWaveManually } from "@/lib/submissionWaves.server";

/** Minimal in-memory stand-in for the two tables the wave code touches. */
function fakeDb(opts: {
  bills: Array<{ id: string; status: string; hold: boolean; batch: string; company?: string }>;
  batches: Array<{ id: string; wave_size?: number; auto_pilot?: boolean }>;
}) {
  const bills = opts.bills.map((b) => ({
    id: b.id,
    status: b.status,
    submit_wave_hold: b.hold,
    submit_batch_id: b.batch,
    company_id: b.company ?? "c1",
    created_at: b.id,
    submit_next_attempt_at: b.hold ? "2999-01-01T00:00:00.000Z" : null,
  }));
  const updates: Array<Record<string, unknown>> = [];

  const billQuery = () => {
    const filters: Array<(r: any) => boolean> = [];
    let payload: any = null;
    let mode: "select" | "update" = "select";
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
      not: () => api,
      update: (p: any) => {
        mode = "update";
        payload = p;
        return api;
      },
      then: (res: any) => res(run()),
    };
    const run = () => {
      const rows = bills.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        updates.push(payload);
        for (const r of rows) Object.assign(r, payload);
      }
      return { data: rows, error: null };
    };
    return api;
  };

  const batchQuery = () => {
    const filters: Array<(r: any) => boolean> = [];
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
      update: () => api,
      maybeSingle: () => ({ data: opts.batches.filter((b) => filters.every((f) => f(b)))[0] ?? null }),
      then: (res: any) => res({ data: opts.batches.filter((b) => filters.every((f) => f(b))), error: null }),
    };
    return api;
  };

  return {
    bills,
    updates,
    from: (t: string) => (t === "billing_records" ? billQuery() : batchQuery()),
  } as any;
}

const held = (b: any) => b.bills.filter((r: any) => r.submit_wave_hold).length;
const eligible = (b: any) =>
  b.bills.filter((r: any) => r.status === "queued" && !r.submit_wave_hold).length;

const makeBatch = (n: number, autoPilot: boolean, activeStatuses: string[] = []) => {
  const bills: any[] = activeStatuses.map((s, i) => ({
    id: `a${i}`,
    status: s,
    hold: false,
    batch: "b1",
  }));
  for (let i = 0; i < n; i++) {
    bills.push({ id: `h${String(i).padStart(3, "0")}`, status: "queued", hold: true, batch: "b1" });
  }
  return fakeDb({ bills, batches: [{ id: "b1", wave_size: 20, auto_pilot: autoPilot }] });
};

describe("auto pilot preference", () => {
  it("defaults to ON when a company has no stored preference", () => {
    expect(resolveAutoPilotDefault(undefined)).toBe(true);
    expect(resolveAutoPilotDefault(null)).toBe(true);
  });

  it("preserves an existing safer company preference", () => {
    expect(resolveAutoPilotDefault(false)).toBe(false);
    expect(resolveAutoPilotDefault(true)).toBe(true);
  });

  it("treats a missing batch flag as ON but an explicit false as OFF", () => {
    expect(shouldAutoPromote({})).toBe(true);
    expect(shouldAutoPromote({ auto_pilot: true })).toBe(true);
    expect(shouldAutoPromote({ auto_pilot: false })).toBe(false);
  });

  it("labels the status for billers", () => {
    expect(autoPilotStatusLabel(true)).toMatch(/next wave starts automatically/i);
    expect(autoPilotStatusLabel(false, 7)).toMatch(/waiting after current wave \(7 held\)/i);
  });
});

describe("auto pilot promotion", () => {
  it("ON releases the next wave automatically (max 20)", async () => {
    const db = makeBatch(47, true);
    const r = await promoteDueWaves(db, {});
    expect(r.released).toBe(20);
    expect(eligible(db)).toBe(20);
    expect(held(db)).toBe(27);
  });

  it("OFF releases nothing and leaves active items untouched", async () => {
    const db = makeBatch(27, false, ["submitting", "submitting", "queued"]);
    const before = JSON.stringify(db.bills.filter((b: any) => !b.submit_wave_hold));
    const r = await promoteDueWaves(db, {});
    expect(r.released).toBe(0);
    expect(held(db)).toBe(27);
    expect(JSON.stringify(db.bills.filter((b: any) => !b.submit_wave_hold))).toBe(before);
  });

  it("OFF still allows a biller to continue the next wave manually", async () => {
    const db = makeBatch(27, false);
    const r = await releaseNextWaveManually(db, "b1");
    expect(r.released).toBe(20);
    expect(held(db)).toBe(7);
  });

  it("resumes promotion when Auto Pilot is switched back ON", async () => {
    const db = makeBatch(27, false);
    expect((await promoteDueWaves(db, {})).released).toBe(0);
    (db.from("submission_batches") as any); // no-op: flip the stored flag directly
    const batches = [{ id: "b1", wave_size: 20, auto_pilot: true }];
    const resumed = fakeDb({
      bills: db.bills.map((b: any) => ({
        id: b.id,
        status: b.status,
        hold: b.submit_wave_hold,
        batch: "b1",
      })),
      batches,
    });
    expect((await promoteDueWaves(resumed, {})).released).toBe(20);
  });

  it("persists across a refresh — state is read from the DB every tick", async () => {
    const db = makeBatch(47, true);
    await promoteDueWaves(db, {}); // 20 eligible
    // Simulate a reload: nothing in memory, the same rows re-read from the DB.
    const reloaded = fakeDb({
      bills: db.bills.map((b: any) => ({
        id: b.id,
        status: b.submit_wave_hold ? "queued" : "submitted",
        hold: b.submit_wave_hold,
        batch: "b1",
      })),
      batches: [{ id: "b1", wave_size: 20, auto_pilot: true }],
    });
    expect((await promoteDueWaves(reloaded, {})).released).toBe(20);
    expect(held(reloaded)).toBe(7);
  });

  it("runs 47 as 20, 20, 7 and 13 as a single wave of 13", async () => {
    let remaining = Array.from({ length: 47 }, (_, i) => i);
    const sizes: number[] = [];
    while (remaining.length) {
      const { release, hold } = splitIntoWaves(remaining, 20);
      sizes.push(release.length);
      remaining = hold;
    }
    expect(sizes).toEqual([20, 20, 7]);

    const db = makeBatch(13, true);
    expect((await promoteDueWaves(db, {})).released).toBe(13);
    expect(held(db)).toBe(0);
  });

  it("only promotes queued held rows — never needs_fix or verifying rows", async () => {
    const db = fakeDb({
      bills: [
        { id: "x1", status: "needs_fix", hold: true, batch: "b1" },
        { id: "x2", status: "queued", hold: true, batch: "b1" },
      ],
      batches: [{ id: "b1", wave_size: 20, auto_pilot: true }],
    });
    const r = await promoteDueWaves(db, {});
    expect(r.released).toBe(1);
    expect(db.bills.find((b: any) => b.id === "x1").submit_wave_hold).toBe(true);
  });
});
