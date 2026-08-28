import { describe, expect, it } from "vitest";
import { mergeDriverRecords } from "@/lib/driverMerge.server";

/** Tiny in-memory stand-in for the PostgREST query builder we actually use. */
function fakeSb(store: Record<string, any[]>) {
  const q = (table: string) => {
    store[table] ??= [];
    let rows = () => store[table]!;
    const state: { filters: [string, any][]; op: null | { kind: "update"; patch: any } } = {
      filters: [],
      op: null,
    };
    const matching = () =>
      rows().filter((r) => state.filters.every(([c, v]) => (r as any)[c] === v));
    const api: any = {
      select: () => api,
      insert: (row: any) => {
        rows().push(Array.isArray(row) ? row[0] : row);
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: any) => {
        state.op = { kind: "update", patch };
        return api;
      },
      eq: (c: string, v: any) => {
        state.filters.push([c, v]);
        return api;
      },
      is: (c: string, v: any) => {
        state.filters.push([c, v]);
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
      then: (res: any) => {
        const hit = matching();
        if (state.op?.kind === "update") for (const r of hit) Object.assign(r, state.op.patch);
        return Promise.resolve(
          res({ data: hit, error: null, count: hit.length }),
        );
      },
    };
    return api;
  };
  return { from: q } as any;
}

const base = {
  drivers: [
    { id: "keep", user_id: "u1", company_id: "co", created_at: "2025-01-01", total_trips: 20 },
    { id: "dupe", user_id: "u1", company_id: "co", created_at: "2025-02-01", total_trips: 2 },
  ],
  profiles: [{ id: "u1", first_name: "Khalid", last_name: "Fadul", email: "k@x.com", phone: "5551112222" }],
  trips: [{ id: "t1", driver_id: "dupe" }],
};

describe("driver merge — pay settings and audit", () => {
  it("keeps the surviving driver's saved percentage and never overwrites it", async () => {
    const store: any = {
      ...structuredClone(base),
      driver_pay_plans: [
        { driver_id: "keep", plan: "commission", commission_percentage: 65 },
        { driver_id: "dupe", plan: "commission", commission_percentage: 10 },
      ],
    };
    await mergeDriverRecords(fakeSb(store), {
      keeperId: "keep",
      duplicateId: "dupe",
      actorId: "admin",
    });
    const keeper = store.driver_pay_plans.find((p: any) => p.driver_id === "keep");
    expect(keeper.commission_percentage).toBe(65);
    // Nothing is deleted — the duplicate's old rate stays as history.
    expect(store.driver_pay_plans).toHaveLength(2);
  });

  it("adopts the duplicate's rate only when the keeper has none", async () => {
    const store: any = {
      ...structuredClone(base),
      driver_pay: [{ driver_id: "dupe", payout_percentage: 55, pay_type: "commission" }],
    };
    await mergeDriverRecords(fakeSb(store), {
      keeperId: "keep",
      duplicateId: "dupe",
      actorId: "admin",
    });
    expect(store.driver_pay[0].driver_id).toBe("keep");
    expect(store.driver_pay[0].payout_percentage).toBe(55);
  });

  it("re-parents work, retires the duplicate with merged_into, and logs the merge", async () => {
    const store: any = structuredClone(base);
    const res = await mergeDriverRecords(fakeSb(store), {
      keeperId: "keep",
      duplicateId: "dupe",
      actorId: "admin",
      note: "reviewed",
    });
    expect(store.trips[0].driver_id).toBe("keep");
    const dupe = store.drivers.find((d: any) => d.id === "dupe");
    expect(dupe.merged_into).toBe("keep");
    expect(dupe.merged_at).toBeTruthy();
    expect(store.drivers).toHaveLength(2); // nothing deleted
    expect(store.payroll_audit_log[0].action).toBe("driver_merged");
    expect(res.total).toBeGreaterThan(0);
  });
});
