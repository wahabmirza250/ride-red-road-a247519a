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
        const chain: any = {
          in: () => chain,
          then: (res: any) => res({ data: [] }),
          eq: () => chain,
          maybeSingle: async () => ({
            data: { company_id: "11111111-2222-4333-8444-555555555555", medicaid_trips: null },
          }),
        };
        return chain;
      },
    });
    return { from: (t: string) => chain(t) } as any;
  }

  it("stores candidates read-only and never writes to billing_records", async () => {
    const captured: any[] = [];
    const supabase = fakeSupabase(captured);
    const fakeSearch = (async () => outcome([{ claim_id: "A", linked: { billing_record_id: "other" } }])) as any;
    const res = await processSweepJob(supabase, {
      id: "r1",
      sweep_id: "s1",
      company_id: "11111111-2222-4333-8444-555555555555",
      billing_record_id: "b1",
      trip_id: "t1",
      member_id: "P1",
      service_date: "08/06/2026",
      attempts: 1,
    } as any, fakeSearch);
    expect(["single", "multiple", "none", "error"]).toContain(res.outcome);
    const touched = captured.filter((c) => c.table === "billing_records" && c.patch);
    expect(touched).toHaveLength(0);
  });

  it("errors out (no portal call) when the trip has no member id", async () => {
    const captured: any[] = [];
    const res = await processSweepJob(fakeSupabase(captured), {
      id: "r2",
      sweep_id: "s1",
      company_id: "11111111-2222-4333-8444-555555555555",
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

describe("authorized auto-link", () => {
  it("refuses to auto-link a claim that already belongs to another bill", async () => {
    const { autoLinkSingleCandidate } = await import("@/lib/reconcileSweep.server");
    await expect(
      autoLinkSingleCandidate({} as any, {
        recordId: "b1",
        resultId: "r1",
        claim: { claim_id: "A", linked: { billing_record_id: "other" } } as any,
      }),
    ).rejects.toThrow(/already linked/i);
  });

  it("only a lone unused candidate is auto-linkable; several are held", () => {
    expect(classifySearch(outcome([{ claim_id: "A", linked: null }]))).toBe("single");
    expect(classifySearch(outcome([{ claim_id: "A" }, { claim_id: "B" }]))).toBe("multiple");
    expect(classifySearch(outcome([]))).toBe("none");
  });
});

describe("certainty before 'no claim'", () => {
  it("an empty answer WITHOUT a portal result state is a retryable error", () => {
    expect(classifySearch(outcome([], { result_state: null }))).toBe("error");
  });
  it("only a portal-confirmed NO_RESULTS is recorded as 'no claim'", () => {
    expect(classifySearch(outcome([], { result_state: "NO_RESULTS" }))).toBe("none");
  });
});
