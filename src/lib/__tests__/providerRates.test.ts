import { describe, it, expect } from "vitest";
import { loadRateRows } from "@/lib/billingRates.server";
import { resolveBillingProviderId } from "@/lib/providerResolve.server";

type Row = Record<string, any>;

/** Minimal PostgREST-ish stub: chained eq/is filters over in-memory tables. */
function db(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => {
          rows = rows.filter((r) => r[c] === v);
          return api;
        },
        is: (c: string, v: any) => {
          rows = rows.filter((r) => (r[c] ?? null) === v);
          return api;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: any) => res({ data: rows, error: null }),
      };
      return api;
    },
  };
}

const COMPANY = "c1";

describe("company-scoped billing rates", () => {
  it("uses the company's own rates", async () => {
    const store = db({
      billing_rate_settings: [
        { company_id: COMPANY, provider_id: "p1", vehicle_type: "ambulatory", unit_type: "trip" },
        { company_id: null, provider_id: null, vehicle_type: "ambulatory", unit_type: "trip" },
      ],
    });
    const { rows, scope } = await loadRateRows(store, {
      companyId: COMPANY,
      vehicleType: "ambulatory",
    });
    expect(scope).toBe("company");
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_id).toBe("p1");
  });

  it("still honours legacy unscoped rates when the company has none", async () => {
    const store = db({
      billing_rate_settings: [
        { company_id: null, provider_id: null, vehicle_type: "ambulatory", unit_type: "mile" },
      ],
    });
    const { rows, scope } = await loadRateRows(store, { companyId: "other" });
    expect(scope).toBe("legacy");
    expect(rows).toHaveLength(1);
  });
});

describe("billing provider resolution", () => {
  it("prefers the configured default provider", async () => {
    const store = db({
      billing_settings: [{ company_id: COMPANY, default_provider_id: "chosen" }],
      billing_rate_settings: [{ company_id: COMPANY, provider_id: "other" }],
    });
    expect(await resolveBillingProviderId(store, COMPANY)).toBe("chosen");
  });

  it("falls back to the single provider owning the company's rates", async () => {
    const store = db({
      billing_settings: [],
      billing_rate_settings: [
        { company_id: COMPANY, provider_id: "p1" },
        { company_id: COMPANY, provider_id: "p1" },
      ],
    });
    expect(await resolveBillingProviderId(store, COMPANY)).toBe("p1");
  });

  it("fails closed when the provider is ambiguous or unknown", async () => {
    const store = db({
      billing_settings: [],
      billing_rate_settings: [
        { company_id: COMPANY, provider_id: "p1" },
        { company_id: COMPANY, provider_id: "p2" },
      ],
    });
    expect(await resolveBillingProviderId(store, COMPANY)).toBeNull();
    expect(await resolveBillingProviderId(store, null)).toBeNull();
  });
});
