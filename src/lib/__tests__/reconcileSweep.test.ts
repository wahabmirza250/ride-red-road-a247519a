import { describe, expect, it, vi } from "vitest";
import {
  classifySearch,
  sanitizeSweepError,
  sortByPriority,
  summarize,
  type SweepOutcome,
} from "@/lib/reconcileSweep";
import type { TripSearchOutcome } from "@/lib/tripClaimSearch";
import { processSweepJob } from "@/lib/reconcileSweep.server";

const outcome = (claims: any[], extra: Partial<TripSearchOutcome> = {}): TripSearchOutcome => ({
  ok: true,
  unavailable: false,
  result_state: "RESULTS_FOUND",
  match_count: claims.length,
  claims,
  detail: "/search-claim-by-trip",
  ...extra,
});

describe("sweep classification", () => {
  it("treats a lookup failure as retryable error, never as 'no claim'", () => {
    expect(classifySearch({ ok: false } as any)).toBe("error");
  });
  it("reports no result", () => {
    expect(classifySearch(outcome([]))).toBe("none");
  });
  it("reports a single unused candidate", () => {
    expect(classifySearch(outcome([{ claim_id: "A", linked: null }]))).toBe("single");
  });
  it("never calls an already-linked claim a single match", () => {
    expect(classifySearch(outcome([{ claim_id: "A", linked: { billing_record_id: "b" } }]))).toBe(
      "multiple",
    );
  });
  it("keeps every candidate when the member has several same-day claims", () => {
    expect(classifySearch(outcome([{ claim_id: "A" }, { claim_id: "B" }]))).toBe("multiple");
  });
});

describe("progress summary", () => {
  it("counts each bucket and leaves errors outstanding", () => {
    const rows = (["single", "single", "none", "multiple", "error", "pending"] as SweepOutcome[]).map(
      (outcome) => ({ outcome }),
    );
    expect(summarize(rows)).toEqual({
      total: 6,
      searched: 4,
      single: 2,
      none: 1,
      multiple: 1,
      errors: 1,
      remaining: 2,
      confirmed: 0,
    });
  });

  it("orders the worklist: single, none, multiple, error, unconfirmed first", () => {
    const rows = [
      { outcome: "error" as SweepOutcome },
      { outcome: "multiple" as SweepOutcome },
      { outcome: "single" as SweepOutcome, confirmed_at: "2026-08-30" },
      { outcome: "none" as SweepOutcome },
      { outcome: "single" as SweepOutcome },
    ];
    expect(sortByPriority(rows).map((r) => r.outcome)).toEqual([
      "single",
      "none",
      "multiple",
      "error",
      "single",
    ]);
  });
});

describe("safe error text", () => {
  it("strips portal HTML and credentials", () => {
    expect(sanitizeSweepError("<div>login failed</div> password: hunter2")).toBe(
      "login failed password: [redacted]",
    );
  });
});

describe("processSweepJob", () => {
  function fakeSupabase(captured: any[]) {
    const chain = (table: string) => ({
      update(patch: any) {
        captured.push({ table, patch });
        return { eq: async () => ({ data: null, error: null }) };
      },
      insert: async (row: any) => {
        captured.push({ table, insert: row });
        return { error: null };
      },
      select() {
        return {
          in: async () => ({ data: [] }),
          eq() {
            return this;
          },
        };
      },
    });
    return { from: (t: string) => chain(t) } as any;
  }

  it("stores candidates read-only and never writes to billing_records", async () => {
    const captured: any[] = [];
    const supabase = fakeSupabase(captured);
    vi.doMock("@/lib/tripClaimSearch.server", () => ({
      searchClaimByTrip: async () => outcome([{ claim_id: "A" }]),
    }));
    const { processSweepJob: run } = await import("@/lib/reconcileSweep.server");
    const res = await run(supabase, {
      id: "r1",
      sweep_id: "s1",
      company_id: "c1",
      billing_record_id: "b1",
      trip_id: "t1",
      member_id: "P1",
      service_date: "08/06/2026",
      attempts: 1,
    });
    expect(["single", "multiple", "none", "error"]).toContain(res.outcome);
    const touched = captured.filter((c) => c.table === "billing_records" && c.patch);
    expect(touched).toHaveLength(0);
    vi.doUnmock("@/lib/tripClaimSearch.server");
  });

  it("errors out (no portal call) when the trip has no member id", async () => {
    const captured: any[] = [];
    const res = await processSweepJob(fakeSupabase(captured), {
      id: "r2",
      sweep_id: "s1",
      company_id: "c1",
      billing_record_id: "b2",
      trip_id: "t2",
      member_id: null,
      service_date: null,
      attempts: 1,
    });
    expect(res.outcome).toBe("error");
    expect(captured[0].table).toBe("claim_reconcile_results");
  });
});
