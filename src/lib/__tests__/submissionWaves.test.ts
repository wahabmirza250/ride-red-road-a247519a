import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAVE_SIZE,
  WAVE_HOLD_UNTIL,
  clampWaveSize,
  isWaveBatchDone,
  waveProgressLabel,
} from "@/lib/submissionWaves";
import { countWave, isStrandedHold, releaseStrandedHolds } from "@/lib/submissionWaves.server";
import {
  classifyEnqueueOutcome,
  isActiveQueueStatus,
} from "@/lib/submissionEnqueueOutcome";

const rows = (spec: Array<[string, boolean?]>) =>
  spec.map(([status, hold]) => ({ status, submit_wave_hold: Boolean(hold) }));

/** Minimal fake of the two chained Supabase calls used by the repair sweep. */
function fakeDb(records: Array<{ id: string; status: string; submit_wave_hold: boolean }>) {
  return {
    from() {
      const filters: Array<(r: any) => boolean> = [];
      let patch: any = null;
      const api: any = {
        update(p: any) {
          patch = p;
          return api;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return api;
        },
        select() {
          const hit = records.filter((r) => filters.every((f) => f(r)));
          for (const r of hit) Object.assign(r, patch);
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
      };
      return api;
    },
  };
}

describe("batch progress counting", () => {
  it("keeps the display cap sane", () => {
    expect(clampWaveSize(20)).toBe(20);
    expect(clampWaveSize(0)).toBe(1);
    expect(clampWaveSize(500)).toBe(50);
    expect(clampWaveSize("nonsense")).toBe(DEFAULT_WAVE_SIZE);
  });

  it("counts held, active and completed bills separately", () => {
    const c = countWave(
      rows([
        ["queued", true],
        ["queued"],
        ["submitting"],
        ["submitted"],
        ["needs_fix"],
      ]),
    );
    expect(c).toEqual({ total: 5, waiting: 1, active: 2, completed: 2 });
  });

  it("reports progress in human terms and finishes only when nothing is left", () => {
    const mid = { total: 100, waiting: 0, active: 20, completed: 80 };
    expect(waveProgressLabel(mid)).toContain("still sending");
    expect(isWaveBatchDone(mid)).toBe(false);
    const done = { total: 100, waiting: 0, active: 0, completed: 100 };
    expect(waveProgressLabel(done)).toBe("100 of 100 completed · batch finished");
    expect(isWaveBatchDone(done)).toBe(true);
  });
});

describe("no queued work can be stranded", () => {
  it("recognises a bill parked by an older build", () => {
    expect(isStrandedHold({ status: "queued", submit_next_attempt_at: WAVE_HOLD_UNTIL })).toBe(true);
    expect(isStrandedHold({ status: "queued", submit_next_attempt_at: null })).toBe(false);
    expect(isStrandedHold({ status: "submitting", submit_next_attempt_at: WAVE_HOLD_UNTIL })).toBe(
      false,
    );
  });

  it("releases every held queued bill and never touches submitting ones", async () => {
    const records = [
      { id: "a", status: "queued", submit_wave_hold: true },
      { id: "b", status: "queued", submit_wave_hold: true },
      { id: "c", status: "submitting", submit_wave_hold: true },
      { id: "d", status: "queued", submit_wave_hold: false },
    ];
    const res = await releaseStrandedHolds(fakeDb(records) as any);
    expect(res.released).toBe(2);
    expect(records.find((r) => r.id === "a")!.submit_wave_hold).toBe(false);
    expect(records.find((r) => r.id === "c")!.submit_wave_hold).toBe(true);
  });
});

describe("enqueue outcome is never a silent duplicate", () => {
  it("treats a successful flip as enqueued", () => {
    expect(classifyEnqueueOutcome({ updated: 1 }).kind).toBe("enqueued");
  });

  it("only calls it a duplicate with real evidence", () => {
    expect(classifyEnqueueOutcome({ updated: 0, statusAfter: "queued" }).kind).toBe("duplicate");
    expect(classifyEnqueueOutcome({ updated: 0, statusAfter: "submitting" }).kind).toBe("duplicate");
    expect(classifyEnqueueOutcome({ updated: 0, errorCode: "23505" }).kind).toBe("duplicate");
  });

  it("reports a real failure instead of hiding it as a duplicate", () => {
    const noop = classifyEnqueueOutcome({ updated: 0, statusAfter: "approved" });
    expect(noop.kind).toBe("failed");
    expect(noop.kind === "failed" && noop.reason).toContain("approved");

    const unreadable = classifyEnqueueOutcome({ updated: 0, readable: false });
    expect(unreadable.kind).toBe("failed");

    const errored = classifyEnqueueOutcome({ updated: 0, errorMessage: "boom" });
    expect(errored.kind).toBe("failed");
  });

  it("knows which statuses count as already in the queue", () => {
    expect(isActiveQueueStatus("queued")).toBe(true);
    expect(isActiveQueueStatus("submitting")).toBe(true);
    expect(isActiveQueueStatus("approved")).toBe(false);
    expect(isActiveQueueStatus(null)).toBe(false);
  });
});
