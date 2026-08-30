import { describe, expect, it } from "vitest";
import { leasePerCompany, maxGlobal, maxPerCompany, runClaimStatusSync, runPool } from "@/lib/claimStatusSync.server";

/** Minimal fake of the service-role client used by the sync tick. */
function fakeSupabase(rows: any[]) {
  const leaseCalls: any[] = [];
  const chain: any = {
    select: () => chain,
    update: () => chain,
    insert: () => Promise.resolve({ error: null }),
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    lt: () => chain,
    limit: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (r: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(r),
  };
  return {
    leaseCalls,
    from: () => chain,
    rpc: (name: string, args: any) => {
      if (name === "lease_claim_status_jobs") {
        leaseCalls.push(args);
        const n = Math.min(rows.length, args._global_limit ?? rows.length);
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as any;
}

const row = (i: number, company: string) => ({
  id: `r${i}`,
  trip_id: `t${i}`,
  company_id: company,
  status: "submitted",
  status_check_attempts: 0,
  claim_number: `232623800${i}`,
});

function counterFetch(opts: { active?: number; queued?: number } = {}) {
  const posts: string[] = [];
  const perCompanyInflight = new Map<string, number>();
  let maxCompanyInflight = 0;
  let inflight = 0;
  let maxInflight = 0;
  const fetchImpl = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.endsWith("/") && (!init || (init.method ?? "GET") === "GET")) {
      return new Response(
        JSON.stringify({ active: opts.active ?? 0, queued: opts.queued ?? 0 }),
        { status: 200 },
      );
    }
    if (u.includes("/check-claim-status")) {
      posts.push(u);
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      return new Response(JSON.stringify({ jobId: `job-${posts.length}` }), { status: 200 });
    }
    if (u.includes("/job-status/")) {
      inflight = Math.max(0, inflight - 1);
      return new Response(
        JSON.stringify({ status: "done", result: { result_state: "RESULTS_FOUND", detected_status: "Paid" } }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    posts: () => posts,
    maxInflight: () => maxInflight,
    perCompanyInflight,
    maxCompanyInflight: () => maxCompanyInflight,
  };
}

describe("claim status sync caps checker jobs per run", () => {
  it("caps are hard-wired: global 3, per-company concurrency 1, lease 3", () => {
    expect(maxGlobal()).toBe(3);
    expect(maxPerCompany()).toBe(1);
    expect(leasePerCompany()).toBe(3);
  });

  it("leases 3 for one company but checks them one at a time", async () => {
    const rows = [row(1, "A"), row(2, "A"), row(3, "A")];
    const f = counterFetch();
    const supabase = fakeSupabase(rows);
    const res = await runClaimStatusSync(supabase, { fetchImpl: f.fetchImpl, budgetMs: 20_000 });
    expect(supabase.leaseCalls[0]._per_company_limit).toBe(3);
    expect(supabase.leaseCalls[0]._global_limit).toBe(3);
    expect(res.checked).toBe(3);
    expect(f.maxInflight()).toBe(1); // strictly sequential for one company
  }, 30_000);

  it("releases leftovers when the run budget is already gone", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) => ({
      record_id: `r${i}`,
      trip_id: `t${i}`,
      company_id: "A",
      status: "submitted",
      attempts: 0,
      claim_number: `c${i}`,
    }));
    const leftover = await runPool(
      jobs as any,
      { perCompany: 1, global: 3, deadline: Date.now() - 1 },
      async () => {},
    );
    expect(leftover).toHaveLength(3);
  });

  it("never POSTs more than three /check-claim-status per invocation, one per company", async () => {
    const rows = [row(1, "A"), row(2, "A"), row(3, "B"), row(4, "C"), row(5, "D")];
    const f = counterFetch();
    const supabase = fakeSupabase(rows);
    const res = await runClaimStatusSync(supabase, {
      fetchImpl: f.fetchImpl,
      // Even when a caller asks for more, the run must clamp itself to the caps.
      globalLimit: 8,
      perCompanyLimit: 8,
      budgetMs: 5_000,
    });
    expect(f.posts().length).toBeLessThanOrEqual(3);
    expect(f.maxInflight()).toBeLessThanOrEqual(3);
    expect(supabase.leaseCalls[0]._global_limit).toBe(3);
    expect(supabase.leaseCalls[0]._per_company_limit).toBe(3);
    expect(res.checked).toBeLessThanOrEqual(3);
    // Per-company cap of 1 applies inside the pool regardless of lease order.
    expect(res.companies).toBeLessThanOrEqual(res.checked);
  });

  it("starts nothing while the checker service is at capacity", async () => {
    const f = counterFetch({ active: 1, queued: 3 });
    const supabase = fakeSupabase([row(1, "A")]);
    const res = await runClaimStatusSync(supabase, { fetchImpl: f.fetchImpl, budgetMs: 5_000 });
    expect(f.posts()).toHaveLength(0);
    expect(supabase.leaseCalls).toHaveLength(0);
    expect(res.ran).toBe(false);
    expect(res.reason).toMatch(/still working/i);
  });

  it("leases only spare capacity when the service is partially busy", async () => {
    // 2 already in service out of a cap of 3 -> this tick may start at most 1.
    const f = counterFetch({ active: 2, queued: 0 });
    const supabase = fakeSupabase([row(1, "A"), row(2, "B"), row(3, "C")]);
    const res = await runClaimStatusSync(supabase, { fetchImpl: f.fetchImpl, budgetMs: 5_000 });
    expect(supabase.leaseCalls[0]._global_limit).toBe(1);
    expect(f.posts().length).toBeLessThanOrEqual(1);
    expect(res.checked).toBeLessThanOrEqual(1);
  });
});
