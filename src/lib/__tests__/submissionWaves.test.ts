import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAVE_SIZE,
  clampWaveSize,
  isWaveBatchDone,
  splitIntoWaves,
  waveProgressLabel,
  waveReleaseCount,
} from "@/lib/submissionWaves";
import { countWave } from "@/lib/submissionWaves.server";

const rows = (spec: Array<[string, boolean?]>) =>
  spec.map(([status, hold]) => ({ status, submit_wave_hold: Boolean(hold) }));

describe("automatic waves", () => {
  it("keeps the wave size sane", () => {
    expect(clampWaveSize(20)).toBe(20);
    expect(clampWaveSize(0)).toBe(1);
    expect(clampWaveSize(500)).toBe(50);
    expect(clampWaveSize("nonsense")).toBe(DEFAULT_WAVE_SIZE);
  });

  it("releases only the first 20 of a 100-bill batch", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `b${i}`);
    const { release, hold } = splitIntoWaves(ids, 20);
    expect(release).toHaveLength(20);
    expect(hold).toHaveLength(80);
    expect(release[0]).toBe("b0");
    expect(hold[0]).toBe("b20");
  });

  it("never holds anything when the batch fits in one wave", () => {
    expect(splitIntoWaves(["a", "b"], 20).hold).toEqual([]);
  });

  it("only refills the wave as slots free up", () => {
    expect(waveReleaseCount(20, 20)).toBe(0);
    expect(waveReleaseCount(17, 20)).toBe(3);
    expect(waveReleaseCount(0, 20)).toBe(20);
    // Never negative, even if more is somehow active than the wave allows.
    expect(waveReleaseCount(25, 20)).toBe(0);
  });

  it("counts held, active and completed bills separately", () => {
    const c = countWave(
      rows([
        ["queued", true],
        ["queued", true],
        ["queued"],
        ["submitting"],
        ["submitted"],
        ["needs_fix"],
      ]),
    );
    expect(c).toEqual({ total: 6, waiting: 2, active: 2, completed: 2 });
  });

  it("takes ALL remaining items when fewer than a full wave are left (47 => 20,20,7)", () => {
    // A wave is a MAXIMUM, not a fixed size.
    let remaining = Array.from({ length: 47 }, (_, i) => `b${i}`);
    const waves: number[] = [];
    while (remaining.length) {
      const { release, hold } = splitIntoWaves(remaining, 20);
      waves.push(release.length);
      remaining = hold;
    }
    expect(waves).toEqual([20, 20, 7]);
  });

  it("runs a batch smaller than the wave size in a single wave (13 => 13)", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `b${i}`);
    const { release, hold } = splitIntoWaves(ids, 20);
    expect(release).toHaveLength(13);
    expect(hold).toEqual([]);
    expect(waveReleaseCount(0, 20)).toBeGreaterThanOrEqual(13);
  });

  it("refills with everything left when the tail is shorter than a wave", () => {
    // 7 held, 0 active → all 7 become eligible at once, not padded to 20.
    const room = waveReleaseCount(0, 20);
    const tail = Array.from({ length: 7 }, (_, i) => `t${i}`);
    expect(tail.slice(0, room)).toHaveLength(7);
  });

  it("reports progress in human terms and finishes only when nothing is left", () => {
    const mid = { total: 100, waiting: 80, active: 20, completed: 0 };
    expect(waveProgressLabel(mid)).toContain("processing next wave");
    expect(isWaveBatchDone(mid)).toBe(false);
    const done = { total: 100, waiting: 0, active: 0, completed: 100 };
    expect(waveProgressLabel(done)).toBe("100 of 100 completed · batch finished");
    expect(isWaveBatchDone(done)).toBe(true);
  });
});
