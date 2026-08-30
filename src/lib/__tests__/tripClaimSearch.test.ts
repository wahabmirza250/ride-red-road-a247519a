import { describe, expect, it, vi } from "vitest";
import { isNoResultState, isResultsState, normalizeTripClaims } from "@/lib/tripClaimSearch";
import { searchClaimByTrip } from "@/lib/tripClaimSearch.server";

const jobBody = (result: any) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: "done", result }),
  text: async () => "",
});

describe("normalizeTripClaims", () => {
  it("maps the checker claim rows and keeps unknown amounts null", () => {
    const claims = normalizeTripClaims({
      claims: [
        { claim_id: "2326240001014", member_id: "P493288", service_date: "08/06/2026", status: "Paid", paid_amount: "$42.50", row: "1" },
        { claim_id: "999", status: "Denied", paid_amount: "" },
        { claim_id: "999", status: "dup" },
      ],
    });
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ claim_id: "2326240001014", paid_amount: 42.5, row: "1" });
    expect(claims[1]!.paid_amount).toBeNull();
  });

  it("never invents a zero amount", () => {
    const [c] = normalizeTripClaims({ claims: [{ claim_id: "a" }] });
    expect(c!.paid_amount).toBeNull();
    expect(c!.charge_amount).toBeNull();
  });
});

describe("result states", () => {
  it("classifies portal answers", () => {
    expect(isResultsState("RESULTS_FOUND")).toBe(true);
    expect(isNoResultState("NO_RESULTS")).toBe(true);
    expect(isNoResultState("RESULTS_FOUND")).toBe(false);
  });
});

describe("searchClaimByTrip", () => {
  it("posts the documented body and returns every candidate claim", async () => {
    const calls: any[] = [];
    const doFetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/search-claim-by-trip")) {
        return { ok: true, status: 200, json: async () => ({ jobId: "j1" }), text: async () => "" } as any;
      }
      return jobBody({
        result_state: "RESULTS_FOUND",
        match_count: 2,
        claims: [{ claim_id: "A" }, { claim_id: "B" }],
      }) as any;
    });
    const out = await searchClaimByTrip({
      companyId: "c1",
      memberId: "P493288",
      serviceDate: "08/06/2026",
      tripId: "t1",
      doFetch: doFetch as any,
      timeoutMs: 20_000,
    });
    expect(out.ok).toBe(true);
    expect(out.match_count).toBe(2);
    expect(out.claims.map((c) => c.claim_id)).toEqual(["A", "B"]);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      company_id: "c1",
      member_id: "P493288",
      service_date: "08/06/2026",
      trip_id: "t1",
    });
  });

  it("reports unavailable (never a false 'no claim') when the route is missing", async () => {
    const doFetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }) as any);
    const out = await searchClaimByTrip({
      companyId: "c1",
      memberId: "P1",
      serviceDate: "08/06/2026",
      tripId: "t1",
      doFetch: doFetch as any,
    });
    expect(out.ok).toBe(false);
    expect(out.unavailable).toBe(true);
    expect(out.claims).toEqual([]);
  });
});
