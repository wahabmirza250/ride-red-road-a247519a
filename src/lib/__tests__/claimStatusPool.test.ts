import { describe, expect, it } from "vitest";
import { runPool, type LeasedJob } from "@/lib/claimStatusSync.server";

const job = (i: number, company: string): LeasedJob => ({
  record_id: `r${i}`,
  trip_id: `t${i}`,
  company_id: company,
  status: "submitted",
  attempts: 0,
  claim_number: `c${i}`,
});

describe("claim status worker pool", () => {
  it("caps concurrency per company and globally", async () => {
    const jobs = [
      ...Array.from({ length: 10 }, (_, i) => job(i, "A")),
      ...Array.from({ length: 10 }, (_, i) => job(i + 10, "B")),
    ];
    let inflight = 0;
    let maxGlobalSeen = 0;
    const perCompany = new Map<string, number>();
    const maxPerCompanySeen = new Map<string, number>();
    const done: string[] = [];

    const leftover = await runPool(
      jobs,
      { perCompany: 4, global: 6, deadline: Date.now() + 10_000 },
      async (j) => {
        const key = j.company_id!;
        inflight++;
        perCompany.set(key, (perCompany.get(key) ?? 0) + 1);
        maxGlobalSeen = Math.max(maxGlobalSeen, inflight);
        maxPerCompanySeen.set(key, Math.max(maxPerCompanySeen.get(key) ?? 0, perCompany.get(key)!));
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        perCompany.set(key, perCompany.get(key)! - 1);
        done.push(j.record_id);
      },
    );

    expect(leftover).toHaveLength(0);
    expect(done).toHaveLength(20);
    expect(new Set(done).size).toBe(20); // no duplicate processing
    expect(maxGlobalSeen).toBeLessThanOrEqual(6);
    expect(maxPerCompanySeen.get("A")!).toBeLessThanOrEqual(4);
    expect(maxPerCompanySeen.get("B")!).toBeLessThanOrEqual(4);
  });

  it("one slow company never blocks another", async () => {
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => job(i, "SLOW")),
      ...Array.from({ length: 3 }, (_, i) => job(i + 100, "FAST")),
    ];
    const finished: string[] = [];
    await runPool(jobs, { perCompany: 4, global: 20, deadline: Date.now() + 10_000 }, async (j) => {
      await new Promise((r) => setTimeout(r, j.company_id === "SLOW" ? 60 : 1));
      finished.push(j.company_id!);
    });
    expect(finished.slice(0, 3)).toEqual(["FAST", "FAST", "FAST"]);
  });

  it("returns unstarted jobs when the run budget is gone", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => job(i, "A"));
    const leftover = await runPool(jobs, { perCompany: 1, global: 1, deadline: Date.now() - 1 }, async () => {});
    expect(leftover).toHaveLength(5);
  });
});
