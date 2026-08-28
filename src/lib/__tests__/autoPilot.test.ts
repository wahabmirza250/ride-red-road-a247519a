import { describe, expect, it } from "vitest";
import {
  AUTO_PILOT_WAVE,
  autoPilotLabel,
  canStopSafely,
  isRunComplete,
  nextFeedSize,
  waveRoom,
} from "@/lib/autoPilot";

describe("Auto Pilot waves", () => {
  it("keeps at most one wave in flight", () => {
    expect(waveRoom(0)).toBe(AUTO_PILOT_WAVE);
    expect(waveRoom(20)).toBe(0);
    expect(waveRoom(17)).toBe(3);
    // Never negative, even if more is somehow moving than the wave allows.
    expect(waveRoom(25)).toBe(0);
  });

  it("takes ALL remaining when fewer than a wave are left (450 => 20s then the tail)", () => {
    let remaining = 450;
    let fed = 0;
    const waves: number[] = [];
    // Simulate: each wave fully drains before the next one is fed.
    while (remaining > 0) {
      const take = nextFeedSize(remaining, 0);
      waves.push(take);
      remaining -= take;
      fed += take;
    }
    expect(fed).toBe(450);
    expect(waves.slice(0, 22)).toEqual(Array(22).fill(20));
    expect(waves[waves.length - 1]).toBe(10);
  });

  it("tops the wave up as slots free instead of waiting for a full wave", () => {
    expect(nextFeedSize(100, 13)).toBe(7);
    expect(nextFeedSize(3, 0)).toBe(3);
    expect(nextFeedSize(100, 20)).toBe(0);
    expect(nextFeedSize(0, 0)).toBe(0);
  });

  it("finishes only when nothing is eligible AND nothing is still moving", () => {
    expect(isRunComplete(0, 0)).toBe(true);
    expect(isRunComplete(0, 4)).toBe(false);
    expect(isRunComplete(5, 0)).toBe(false);
  });

  it("never offers to cancel work that may have reached the portal", () => {
    expect(canStopSafely("queued")).toBe(true);
    expect(canStopSafely("submitting")).toBe(false);
    expect(canStopSafely("submitted")).toBe(false);
    expect(canStopSafely("needs_fix")).toBe(false);
  });

  it("says what it is doing in plain words", () => {
    expect(autoPilotLabel({ running: false, remaining: 54, inFlight: 0, enqueued: 0 })).toContain(
      "54 bills ready",
    );
    expect(autoPilotLabel({ running: false, remaining: 0, inFlight: 0, enqueued: 0 })).toBe(
      "Nothing ready to send",
    );
    expect(autoPilotLabel({ running: true, remaining: 30, inFlight: 20, enqueued: 20 })).toContain(
      "20 sending, 30 to go",
    );
    expect(autoPilotLabel({ running: true, remaining: 0, inFlight: 4, enqueued: 50 })).toContain(
      "finishing",
    );
    expect(autoPilotLabel({ running: true, remaining: 0, inFlight: 0, enqueued: 50 })).toBe(
      "Auto Pilot finished",
    );
  });
});
