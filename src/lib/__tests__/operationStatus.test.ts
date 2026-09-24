import { describe, it, expect } from "vitest";
import {
  locationState,
  LOCATION_FRESH_MS,
  localDateTimeInput,
  localInputToISOString,
} from "../operationStatus";
describe("location truthfulness", () => {
  const now = Date.parse("2026-09-24T22:00:00Z");
  const d = {
    status: "available",
    current_lat: 0,
    current_lng: 0,
    last_location_at: new Date(now).toISOString(),
  };
  it("accepts valid zero coordinates and current timestamps", () =>
    expect(locationState(d, now)).toBe("Live"));
  it("expires even when availability stays online", () =>
    expect(locationState(d, now + LOCATION_FRESH_MS + 1)).toBe("Stale"));
  it("never calls missing, invalid or far-future timestamps live", () => {
    expect(locationState({ ...d, last_location_at: null }, now)).toBe("No location");
    expect(locationState({ ...d, last_location_at: "invalid" }, now)).toBe("Stale");
    expect(
      locationState({ ...d, last_location_at: new Date(now + 60000).toISOString() }, now),
    ).toBe("Stale");
    expect(locationState({ ...d, status: "offline" }, now)).toBe("Offline");
  });
});
describe("pickup clock conversion", () => {
  for (const [month, day] of [
    [0, 15],
    [8, 24],
    [10, 1],
  ])
    it(`preserves local pickup month ${month + 1}`, () => {
      const date = new Date(2026, month, day, 16, 30);
      const input = localDateTimeInput(date);
      expect(input).toMatch(/T16:30$/);
      expect(localInputToISOString(input)).toBe(date.toISOString());
    });
  it("rejects malformed dates instead of saving an adjusted pickup", () => {
    expect(() => localInputToISOString("2026-02-31T16:30")).toThrow();
    expect(() => localInputToISOString("")).toThrow();
  });
  it("rejects a daylight-saving gap when the local clock has one", () => {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "America/Denver")
      expect(() => localInputToISOString("2026-03-08T02:30")).toThrow();
  });
});
