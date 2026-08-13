import { expect, test } from "vitest";
import { digitsFromBracketAware } from "../paperBillParse";
test("brackets", () => {
  expect(digitsFromBracketAware("(8)")).toBe("8");
  expect(digitsFromBracketAware("1 (8)")).toBe("8");
  expect(digitsFromBracketAware("(8) 12mi")).toBe("8");
  expect(digitsFromBracketAware("[8] miles")).toBe("8");
  expect(digitsFromBracketAware("124,563")).toBe("124563");
  expect(digitsFromBracketAware("(124,563) odo")).toBe("124563");
});

import { normalizeClockTime, mountainIso } from "../paperBillParse";
test("clock times", () => {
  expect(normalizeClockTime("9:15 AM")).toBe("09:15");
  expect(normalizeClockTime("12:05 pm")).toBe("12:05");
  expect(normalizeClockTime("12:05 am")).toBe("00:05");
  expect(normalizeClockTime("14:05")).toBe("14:05");
  expect(normalizeClockTime("")).toBeNull();
  expect(normalizeClockTime("smudge")).toBeNull();
});
test("no invented pickup time", () => {
  expect(mountainIso("2026-08-13", "09:15")).toBe("2026-08-13T15:15:00.000Z");
  expect(mountainIso("2026-08-13", null)).toBe("2026-08-13T06:00:00.000Z");
});
