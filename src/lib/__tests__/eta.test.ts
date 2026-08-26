import { describe, expect, it } from "vitest";
import {
  destinationKey,
  etaReducer,
  etaText,
  initialEtaState,
  shouldRequestEta,
  ETA_REFRESH_MS,
  type EtaState,
} from "@/lib/eta";

const A = { lat: 39.7392, lng: -104.9903 };
const stopOne = { lat: 39.75, lng: -104.99 };
const stopTwo = { lat: 39.9, lng: -105.1 };

function request(state: EtaState, from = A, dest = stopOne, at = 1000) {
  return etaReducer(state, { type: "request", from, destKey: destinationKey(dest)!, at });
}

describe("live arrival time", () => {
  it("asks for an estimate as soon as a route becomes active", () => {
    expect(shouldRequestEta(initialEtaState, A, destinationKey(stopOne), 0)).toBe(true);
    expect(shouldRequestEta(initialEtaState, null, destinationKey(stopOne), 0)).toBe(false);
    expect(shouldRequestEta(initialEtaState, A, null, 0)).toBe(false);
  });

  it("recalculates when the driver keeps moving", () => {
    let s = request(initialEtaState);
    s = etaReducer(s, {
      type: "result",
      seq: s.seq,
      result: { distanceText: "3.0 mi", durationText: "9 min", polyline: "x" },
      at: 1000,
    });
    // Still parked at the same corner, moments later: no new request.
    expect(shouldRequestEta(s, A, destinationKey(stopOne), 1200)).toBe(false);
    // Driven a few blocks: recalculate immediately.
    const moved = { lat: A.lat + 0.01, lng: A.lng };
    expect(shouldRequestEta(s, moved, destinationKey(stopOne), 1200)).toBe(true);
    // Standing still but the estimate has aged out: refresh anyway.
    expect(shouldRequestEta(s, A, destinationKey(stopOne), 1000 + ETA_REFRESH_MS + 1)).toBe(true);
  });

  it("clears the old numbers the instant the next stop changes", () => {
    let s = request(initialEtaState);
    s = etaReducer(s, {
      type: "result",
      seq: s.seq,
      result: { distanceText: "3.0 mi", durationText: "9 min", polyline: "x" },
      at: 1000,
    });
    expect(shouldRequestEta(s, A, destinationKey(stopTwo), 1100)).toBe(true);
    const advanced = request(s, A, stopTwo, 1100);
    expect(advanced.durationText).toBeNull();
    expect(etaText(advanced)).toBe("Updating ETA…");
  });

  it("never lets an older answer overwrite a newer one", () => {
    let s = request(initialEtaState, A, stopOne, 1000);
    const firstSeq = s.seq;
    s = request(s, { lat: A.lat + 0.02, lng: A.lng }, stopOne, 2000);
    const secondSeq = s.seq;
    s = etaReducer(s, {
      type: "result",
      seq: secondSeq,
      result: { distanceText: "1.0 mi", durationText: "4 min", polyline: "new" },
      at: 2100,
    });
    // The slow first response lands last and must be ignored.
    s = etaReducer(s, {
      type: "result",
      seq: firstSeq,
      result: { distanceText: "9.0 mi", durationText: "30 min", polyline: "old" },
      at: 2200,
    });
    expect(s.durationText).toBe("4 min");
    expect(etaText(s)).toBe("4 min · 1.0 mi");
  });

  it("shows a clear temporary state when routing fails, and recovers", () => {
    let s = request(initialEtaState);
    s = etaReducer(s, {
      type: "result",
      seq: s.seq,
      result: { distanceText: "3.0 mi", durationText: "9 min", polyline: "x" },
      at: 1000,
    });
    s = request(s, { lat: A.lat + 0.02, lng: A.lng }, stopOne, 2000);
    expect(etaText(s)).toBe("Updating ETA…");
    s = etaReducer(s, { type: "error", seq: s.seq, at: 2100 });
    expect(s.status).toBe("unavailable");
    expect(etaText(s)).toBe("ETA unavailable");
    // A failure must not block the next attempt.
    expect(shouldRequestEta(s, { lat: A.lat + 0.05, lng: A.lng }, destinationKey(stopOne), 2200)).toBe(true);
    s = request(s, { lat: A.lat + 0.05, lng: A.lng }, stopOne, 2200);
    s = etaReducer(s, {
      type: "result",
      seq: s.seq,
      result: { distanceText: "2.0 mi", durationText: "6 min", polyline: "y" },
      at: 2300,
    });
    expect(etaText(s)).toBe("6 min · 2.0 mi");
  });

  it("treats an empty route answer as unavailable rather than stale", () => {
    let s = request(initialEtaState);
    s = etaReducer(s, { type: "result", seq: s.seq, result: null, at: 1100 });
    expect(etaText(s)).toBe("ETA unavailable");
  });
});
