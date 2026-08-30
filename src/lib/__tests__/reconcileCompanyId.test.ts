import { describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID_CONFIG_ERROR,
  isUuid,
  looksLikeAccountKey,
  normalizeCompanyId,
  requirePortalCompanyId,
} from "@/lib/companyUuid";
import { searchClaimByTrip } from "@/lib/tripClaimSearch.server";
import { processSweepJob } from "@/lib/reconcileSweep.server";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("company id discipline", () => {
  it("accepts a tenant UUID and rejects every portal account key shape", () => {
    expect(isUuid(UUID)).toBe(true);
    for (const bad of [
      "acct:hfc-colorado:londonalfieri22",
      "nhcpf-colorado:someone@example.com",
      "hcpf-colorado",
      "",
      null,
    ]) {
      expect(normalizeCompanyId(bad)).toBeNull();
    }
    expect(looksLikeAccountKey("acct:hfc-colorado:londonalfieri22")).toBe(true);
    expect(looksLikeAccountKey(UUID)).toBe(false);
    expect(() => requirePortalCompanyId("acct:x")).toThrow(COMPANY_ID_CONFIG_ERROR);
  });
});

describe("searchClaimByTrip never sends an account key as company_id", () => {
  it("refuses locally, without any portal call, when company_id is an acct key", async () => {
    const doFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as any);
    const out = await searchClaimByTrip({
      companyId: "acct:hfc-colorado:londonalfieri22",
      memberId: "P493288",
      serviceDate: "08/06/2026",
      tripId: "t1",
      doFetch: doFetch as any,
    });
    expect(doFetch).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.unavailable).toBe(true);
    expect(out.detail).toBe(COMPANY_ID_CONFIG_ERROR);
  });

  it("posts the billing company UUID verbatim", async () => {
    const bodies: any[] = [];
    const doFetch = vi.fn(async (url: any, init: any) => {
      if (String(url).endsWith("/search-claim-by-trip")) {
        bodies.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ jobId: "j1" }), text: async () => "" } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "done", result: { result_state: "NO_RESULTS", claims: [] } }),
        text: async () => "",
      } as any;
    });
    await searchClaimByTrip({
      companyId: UUID.toUpperCase(),
      memberId: "P493288",
      serviceDate: "08/06/2026",
      tripId: "t1",
      doFetch: doFetch as any,
      timeoutMs: 20_000,
    });
    expect(bodies[0].company_id).toBe(UUID);
    expect(String(bodies[0].company_id)).not.toMatch(/acct:|hcpf/i);
  });
});

describe("sweep job company id resolution", () => {
  function fakeSupabase(opts: { recordCompanyId?: string | null }, captured: any[]) {
    return {
      from(table: string) {
        return {
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
              eq: () => chain,
              in: async () => ({ data: [] }),
              maybeSingle: async () => ({
                data: { company_id: opts.recordCompanyId ?? null, medicaid_trips: null },
              }),
            };
            return chain;
          },
        };
      },
    } as any;
  }

  const job = (companyId: any) => ({
    id: "r1",
    sweep_id: "s1",
    company_id: companyId,
    billing_record_id: "b1",
    trip_id: "t1",
    member_id: "P493288",
    service_date: "08/06/2026",
    attempts: 1,
  });

  it("re-reads the billing record's UUID when the queued value is an acct key", async () => {
    const captured: any[] = [];
    const supabase = fakeSupabase({ recordCompanyId: UUID }, captured);
    const calls: string[] = [];
    const fakeSearch = (async (a: any) => {
      calls.push(a.companyId);
      return { ok: true, unavailable: false, result_state: "NO_RESULTS", match_count: 0, claims: [], detail: "x" };
    }) as any;
    const res = await processSweepJob(supabase, job("acct:hfc-colorado:londonalfieri22") as any, fakeSearch);
    expect(calls).toEqual([UUID]);
    expect(res.outcome).toBe("none");
    expect(captured.some((c) => c.table === "claim_reconcile_results" && c.patch?.company_id === UUID)).toBe(
      true,
    );
  });

  it("records a retryable configuration error and calls no portal when no UUID exists", async () => {
    const captured: any[] = [];
    const supabase = fakeSupabase({ recordCompanyId: null }, captured);
    const res = await processSweepJob(supabase, job("acct:hfc-colorado:londonalfieri22") as any);
    expect(res.outcome).toBe("error");
    const err = captured.find((c) => c.patch?.outcome === "error");
    expect(err.patch.error).toBe(COMPANY_ID_CONFIG_ERROR);
    // retryable: the row goes back through the normal lease path, unlocked
    expect(err.patch.locked_until).toBeNull();
  });
});
