import { describe, it, expect } from "vitest";
import { performBillDelete, classifyBills, PERMISSION_MESSAGE } from "@/lib/deleteBills";

function fakeSupabase(opts: { deleted: any[] }) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        const state: any = { table };
        const b: any = {
          delete: () => {
            state.op = "delete";
            return b;
          },
          update: (u: any) => {
            state.op = "update";
            state.u = u;
            return b;
          },
          in: (col: string, v: any) => {
            state.col = col;
            state.ids = v;
            calls.push({ ...state });
            return b;
          },
          select: async () =>
            table === "billing_records" ? { data: opts.deleted, error: null } : { data: [], error: null },
          then: (res: any) => res({ data: [], error: null }),
        };
        return b;
      },
    } as any,
  };
}

const clean = { id: "a", status: "approved", trip_id: "t-a", state_confirmation_number: null };
const submitted = {
  id: "b",
  status: "approved",
  trip_id: "t-b",
  state_confirmation_number: "2326225001086",
};

describe("bill deletion safety", () => {
  it("blocks a bill that has a real portal confirmation number even when status is approved", () => {
    const { blocked, deletable } = classifyBills([clean, submitted] as any);
    expect(deletable.map((r) => r.id)).toEqual(["a"]);
    expect(blocked[0]!.id).toBe("b");
    expect(blocked[0]!.reason).toContain("2326225001086");
  });

  it("deletes the clean bill and reports the protected one", async () => {
    const sb = fakeSupabase({ deleted: [{ id: "a", trip_id: "t-a" }] });
    const res = await performBillDelete(sb.client, [clean, submitted] as any);
    expect(res.deleted).toBe(1);
    expect(res.blocked).toHaveLength(1);
    // the protected bill was never even included in the delete filter
    const del = sb.calls.find((c) => c.table === "billing_records" && c.op === "delete");
    expect(del.ids).toEqual(["a"]);
    // trip of the deleted bill is rejected
    const upd = sb.calls.find((c) => c.table === "medicaid_trips");
    expect(upd.ids).toEqual(["t-a"]);
  });

  it("reports a real error when RLS silently removes zero rows", async () => {
    const sb = fakeSupabase({ deleted: [] });
    await expect(performBillDelete(sb.client, [clean] as any)).rejects.toThrow(PERMISSION_MESSAGE);
  });

  it("refuses outright when everything selected is protected", async () => {
    const sb = fakeSupabase({ deleted: [] });
    await expect(performBillDelete(sb.client, [submitted] as any)).rejects.toThrow(
      /can't be deleted/i,
    );
  });
});
