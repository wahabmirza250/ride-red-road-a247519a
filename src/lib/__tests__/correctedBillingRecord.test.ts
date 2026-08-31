/**
 * The corrected claim's OWN billing record (2026-08-31 incident cover).
 * Kept in its own file so the real module is exercised, not a mock.
 */
import { describe, expect, it } from "vitest";
import { ensureCorrectedBillingRecord } from "@/lib/correctedRecord.server";

type Row = Record<string, any>;

function fakeDb(records: Row[]) {
  const state = { records: [...records], inserts: 0 };
  const api = {
    from(table: string) {
      if (table !== "billing_records") throw new Error("unexpected table " + table);
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => (filters.push((r) => r[col] === val), builder),
        is: (col: string, val: any) => (filters.push((r) => (r[col] ?? null) === val), builder),
        maybeSingle: async () => ({
          data: state.records.find((r) => filters.every((f) => f(r))) ?? null,
          error: null,
        }),
        insert: (row: Row) => {
          const clash = state.records.find(
            (r) => r.resubmission_id && r.resubmission_id === row.resubmission_id,
          );
          return {
            select: () => ({
              maybeSingle: async () => {
                if (clash) return { data: null, error: { message: "duplicate key" } };
                const created = { id: `corrected-${++state.inserts}`, ...row };
                state.records.push(created);
                return { data: created, error: null };
              },
            }),
          };
        },
      };
      return builder;
    },
  };
  return { api, state };
}

const ORIGINAL = {
  id: "orig-1",
  trip_id: "trip-1",
  trip_form_id: "form-1",
  company_id: "co-1",
  resubmission_id: null,
  status: "denied",
  state_confirmation_number: "2326232001459",
};

describe("a corrected claim gets its OWN billing record", () => {
  it("never returns the original denied record", async () => {
    const { api } = fakeDb([{ ...ORIGINAL }]);
    const rec = await ensureCorrectedBillingRecord(api, {
      resubmissionId: "res-1",
      tripId: "trip-1",
      companyId: "co-1",
    });
    expect(rec.id).not.toBe("orig-1");
    expect(rec.created).toBe(true);
  });

  it("leaves the original claim number, status and history untouched", async () => {
    const { api, state } = fakeDb([{ ...ORIGINAL }]);
    await ensureCorrectedBillingRecord(api, { resubmissionId: "res-1", tripId: "trip-1" });
    const original = state.records.find((r) => r.id === "orig-1")!;
    expect(original.status).toBe("denied");
    expect(original.state_confirmation_number).toBe("2326232001459");
  });

  it("carries no claim number of its own", async () => {
    const { api, state } = fakeDb([{ ...ORIGINAL }]);
    const rec = await ensureCorrectedBillingRecord(api, {
      resubmissionId: "res-1",
      tripId: "trip-1",
    });
    const created = state.records.find((r) => r.id === rec.id)!;
    expect(created.state_confirmation_number ?? null).toBeNull();
    expect(created.status).toBe("pending_submit");
  });

  it("is idempotent: clicking twice cannot create two corrected records", async () => {
    const { api, state } = fakeDb([{ ...ORIGINAL }]);
    const a = await ensureCorrectedBillingRecord(api, {
      resubmissionId: "res-1",
      tripId: "trip-1",
    });
    const b = await ensureCorrectedBillingRecord(api, {
      resubmissionId: "res-1",
      tripId: "trip-1",
    });
    expect(b.id).toBe(a.id);
    expect(b.created).toBe(false);
    expect(state.records.filter((r) => r.resubmission_id === "res-1")).toHaveLength(1);
  });
});

