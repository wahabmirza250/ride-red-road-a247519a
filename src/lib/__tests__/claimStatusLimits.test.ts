import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { envInt } from "@/lib/claimStatusSync.server";

const KEY = "TEST_CLAIM_STATUS_LIMIT";

describe("env-backed limits are validated and clamped", () => {
  beforeEach(() => {
    delete process.env[KEY];
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("falls back when unset, empty or not a number", () => {
    expect(envInt(KEY, 4, 1, 50)).toBe(4);
    process.env[KEY] = "";
    expect(envInt(KEY, 4, 1, 50)).toBe(4);
    process.env[KEY] = "banana";
    expect(envInt(KEY, 4, 1, 50)).toBe(4);
  });

  it("clamps values below the floor and above the ceiling", () => {
    process.env[KEY] = "0";
    expect(envInt(KEY, 4, 1, 50)).toBe(1);
    process.env[KEY] = "-99";
    expect(envInt(KEY, 4, 1, 50)).toBe(1);
    process.env[KEY] = "100000";
    expect(envInt(KEY, 4, 1, 50)).toBe(50);
  });

  it("accepts a sane value and floors fractions", () => {
    process.env[KEY] = "12.7";
    expect(envInt(KEY, 4, 1, 50)).toBe(12);
  });
});
