import { describe, expect, it } from "vitest";
import {
  TARGET_SECONDS_PER_CLAIM,
  claimsPerHour,
  completionTimestamps,
  etaSeconds,
  filterDoneClaims,
  formatSeconds,
  rollingAvgSecondsPerClaim,
  throughputSummary,
  type DoneClaim,
} from "@/lib/submissionThroughput";

const iso = (base: number, offsetSec: number) => new Date(base + offsetSec * 1000).toISOString();
const BASE = Date.UTC(2026, 7, 25, 12, 0, 0);

function doneRow(i: number, offsetSec: number, over: Partial<DoneClaim> = {}): DoneClaim {
  return {
    id: `r${i}`,
    tripId: `t${i}`,
    status: "submitted",
    claimId: `23262370012${i}`,
    completedAt: iso(BASE, offsetSec),
    batchId: "b1",
    batchLabel: "Morning batch",
    biller: "Ann Biller",
    passenger: `Rider ${i}`,
    ...over,
  };
}

describe("throughput telemetry", () => {
  it("measures average seconds per completed claim from real timestamps", () => {
    const rows = [0, 45, 90, 135].map((s, i) => doneRow(i, s));
    const avg = rollingAvgSecondsPerClaim(completionTimestamps(rows));
    expect(avg).toBe(45);
    expect(claimsPerHour(avg)).toBe(80);
  });

  it("reports the measured number even when slower than the 60s target", () => {
    const rows = [0, 120, 240].map((s, i) => doneRow(i, s));
    const t = throughputSummary(rows, 0);
    expect(t.avgSecondsPerClaim).toBe(120);
    expect(t.meetsTarget).toBe(false);
    expect(TARGET_SECONDS_PER_CLAIM).toBe(60);
  });

  it("returns null (never a guess) with fewer than two completions", () => {
    expect(rollingAvgSecondsPerClaim([])).toBeNull();
    const t = throughputSummary([doneRow(0, 0)], 5);
    expect(t.avgSecondsPerClaim).toBeNull();
    expect(t.etaSeconds).toBeNull();
    expect(t.meetsTarget).toBeNull();
  });

  it("only uses the most recent window so old slow runs do not skew live speed", () => {
    const slow = [0, 600, 1200];
    const fast = [1230, 1260, 1290, 1320];
    const rows = [...slow, ...fast].map((s, i) => doneRow(i, s));
    expect(rollingAvgSecondsPerClaim(completionTimestamps(rows), 4)).toBe(30);
  });

  it("estimates ETA for the current queue and formats it", () => {
    expect(etaSeconds(20, 45)).toBe(900);
    expect(etaSeconds(0, 45)).toBe(0);
    expect(etaSeconds(10, null)).toBeNull();
    expect(formatSeconds(900)).toBe("15m");
    expect(formatSeconds(45)).toBe("45s");
    expect(formatSeconds(5400)).toBe("1h 30m");
    expect(formatSeconds(null)).toBe("—");
  });

  it("ETA for a 400-claim day at the target rate is ten hours or less", () => {
    const eta = etaSeconds(400, TARGET_SECONDS_PER_CLAIM)!;
    expect(eta / 3600).toBeLessThanOrEqual(10);
  });

  it("searches the done history on safe fields only", () => {
    const rows = [
      doneRow(1, 0, { claimId: "2326237001236", passenger: "Pablo Soto" }),
      doneRow(2, 60, { claimId: "2326237001238", passenger: "Ann Reed", biller: "Joe" }),
    ];
    expect(filterDoneClaims(rows, "pablo")).toHaveLength(1);
    expect(filterDoneClaims(rows, "1238")[0]!.passenger).toBe("Ann Reed");
    expect(filterDoneClaims(rows, "morning")).toHaveLength(2);
    expect(filterDoneClaims(rows, "")).toHaveLength(2);
    expect(filterDoneClaims(rows, "nope")).toHaveLength(0);
  });
});
