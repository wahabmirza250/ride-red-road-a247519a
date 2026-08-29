import { describe, expect, it } from "vitest";
import { checkOneClaim } from "@/lib/claimStatusSync.server";

/**
 * Production stall: a single claim could poll for up to 75s while the whole
 * scheduler tick only had a 45s budget, so the cron HTTP call was cancelled
 * before the run ever wrote its results back. A check must never poll past
 * the run's hard deadline.
 */
describe("status check respects the run budget", () => {
  const neverFinishes = (async (url: string) => {
    if (String(url).includes("check-claim-status"))
      return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
    return new Response(JSON.stringify({ status: "queued" }), { status: 200 });
  }) as unknown as typeof fetch;

  it("stops polling at the hard deadline instead of its own 75s timeout", async () => {
    const started = Date.now();
    const out = await checkOneClaim("co-1", "CLM1", neverFinishes, Date.now() + 4_000);
    const took = Date.now() - started;
    expect(out.ok).toBe(false);
    expect(took).toBeLessThan(20_000);
  }, 30_000);
});
