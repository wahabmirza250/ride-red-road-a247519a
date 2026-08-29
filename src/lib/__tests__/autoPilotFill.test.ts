import { describe, expect, it } from "vitest";
import { AUTO_PILOT_WAVE, fillWave } from "@/lib/autoPilot";

const ids = (n: number, prefix = "b") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Submit stub: every id is queued. */
const allQueue = async (batch: string[]) => ({ queued: batch.length });

describe("Auto Pilot wave fill", () => {
  it("tops the wave up to 20 when 1 is already submitting (100 eligible => 19 queued)", async () => {
    const res = await fillWave({ eligible: ids(100), inFlight: 1, submit: allQueue });
    expect(res.queued).toBe(19);
  });

  it("adds 16 when 4 are submitting and nothing is queued", async () => {
    const res = await fillWave({ eligible: ids(100), inFlight: 4, submit: allQueue });
    expect(res.queued).toBe(16);
  });

  it("adds nothing when a full wave is already in flight", async () => {
    let calls = 0;
    const res = await fillWave({
      eligible: ids(100),
      inFlight: AUTO_PILOT_WAVE,
      submit: async (b) => {
        calls++;
        return { queued: b.length };
      },
    });
    expect(res.queued).toBe(0);
    expect(calls).toBe(0);
  });

  it("feeds the whole tail when fewer than a wave remain", async () => {
    const res = await fillWave({ eligible: ids(7), inFlight: 0, submit: allQueue });
    expect(res.queued).toBe(7);
    expect(res.attempted).toBe(7);
  });

  it("does not let refused bills consume the wave — it takes the next candidates", async () => {
    // The first 19 are blocked (awaiting manual verification, missing data...).
    const blocked = new Set(ids(19, "blocked"));
    const eligible = [...ids(19, "blocked"), ...ids(50, "good")];
    const seen: string[] = [];
    const res = await fillWave({
      eligible,
      inFlight: 0,
      submit: async (batch) => {
        seen.push(...batch);
        return { queued: batch.filter((id) => !blocked.has(id)).length };
      },
    });
    expect(res.queued).toBe(AUTO_PILOT_WAVE);
    expect(seen.length).toBeGreaterThan(AUTO_PILOT_WAVE);
    // Never over-fills the wave.
    expect(res.queued).toBeLessThanOrEqual(AUTO_PILOT_WAVE);
  });

  it("stops after the round budget instead of scanning forever", async () => {
    const res = await fillWave({
      eligible: ids(500),
      inFlight: 0,
      maxRounds: 3,
      submit: async () => ({ queued: 0 }),
    });
    expect(res.rounds).toBe(3);
    expect(res.queued).toBe(0);
  });

  it("refills as claims settle: freed slots are topped back to 20", async () => {
    let inFlight = 20;
    // Four claims settle.
    inFlight -= 4;
    const res = await fillWave({ eligible: ids(100), inFlight, submit: allQueue });
    expect(res.queued).toBe(4);
  });
});
