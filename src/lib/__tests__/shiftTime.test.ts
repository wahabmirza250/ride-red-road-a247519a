import { describe, expect, it } from "vitest";
import {
  earningsInWindow,
  formatHours,
  hoursInWindow,
  isStaleOpenShift,
  roundHours,
  shiftHours,
  startOfDayMs,
  sumHoursInWindow,
} from "@/lib/shiftTime";

const iso = (ms: number) => new Date(ms).toISOString();

describe("driver work hours", () => {
  it("calculates a finished shift from its timestamps", () => {
    const start = Date.parse("2026-08-25T14:00:00Z");
    const row = { clock_in_at: iso(start), clock_out_at: iso(start + 7.5 * 3_600_000) };
    expect(roundHours(shiftHours(row, start + 99 * 3_600_000))).toBe(7.5);
  });

  it("keeps counting an active shift and survives a refresh", () => {
    const start = Date.parse("2026-08-25T14:00:00Z");
    const row = { clock_in_at: iso(start), clock_out_at: null };
    // The app was closed and reopened; hours come only from the stored start.
    expect(roundHours(shiftHours(row, start + 3 * 3_600_000))).toBe(3);
    expect(roundHours(shiftHours(row, start + 5 * 3_600_000))).toBe(5);
  });

  it("counts only today's part of an overnight shift", () => {
    const now = Date.parse("2026-08-26T09:00:00Z");
    const dayStart = startOfDayMs(now);
    const row = { clock_in_at: iso(dayStart - 4 * 3_600_000), clock_out_at: null };
    const today = hoursInWindow(row, dayStart, now, now);
    const total = shiftHours(row, now);
    expect(roundHours(total - today)).toBe(4);
    expect(today).toBeGreaterThan(0);
    expect(today).toBeLessThan(total);
  });

  it("still reports hours for a shift that started on an earlier day", () => {
    const now = Date.parse("2026-08-26T09:00:00Z");
    const dayStart = startOfDayMs(now);
    const rows = [
      { clock_in_at: iso(dayStart - 30 * 3_600_000), clock_out_at: null },
      { clock_in_at: iso(dayStart + 3_600_000), clock_out_at: iso(dayStart + 3 * 3_600_000) },
    ];
    expect(sumHoursInWindow(rows, dayStart, now, now)).toBeGreaterThan(2);
  });

  it("never returns negative time for out-of-order timestamps", () => {
    const start = Date.parse("2026-08-25T14:00:00Z");
    const row = { clock_in_at: iso(start), clock_out_at: iso(start - 3_600_000) };
    expect(shiftHours(row, start)).toBe(0);
    expect(hoursInWindow(row, start - 10_000, start, start)).toBe(0);
  });

  it("pays hourly work from the hours inside the window", () => {
    const now = Date.parse("2026-08-26T09:00:00Z");
    const dayStart = startOfDayMs(now);
    const rows = [
      { clock_in_at: iso(dayStart), clock_out_at: iso(dayStart + 2 * 3_600_000), hourly_rate_snapshot: 20 },
    ];
    expect(earningsInWindow(rows, dayStart, now, now, null)).toBe(40);
  });

  it("flags a shift left running past the safety limit", () => {
    const start = Date.parse("2026-08-20T14:00:00Z");
    const row = { clock_in_at: iso(start), clock_out_at: null };
    expect(isStaleOpenShift(row, start + 4 * 3_600_000)).toBe(false);
    expect(isStaleOpenShift(row, start + 20 * 3_600_000)).toBe(true);
  });

  it("formats hours for the driver", () => {
    expect(formatHours(0)).toBe("0h 0m");
    expect(formatHours(6.7)).toBe("6h 42m");
    expect(formatHours(1.999)).toBe("2h 0m");
  });
});
