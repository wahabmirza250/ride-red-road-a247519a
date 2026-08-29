import { describe, expect, it } from "vitest";
import { chunk, selectAllPages, selectIn } from "@/lib/dbChunk";

function fakeDb(rowsByChunk: (ids: string[]) => any[], maxIn = 200) {
  const seen: string[][] = [];
  return {
    seen,
    from() {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              seen.push(ids);
              if (ids.length > maxIn) {
                return Promise.resolve({ data: null, error: { message: "URI too long" } });
              }
              return Promise.resolve({ data: rowsByChunk(ids), error: null });
            },
          };
        },
      };
    },
  } as any;
}

describe("chunked IN reads", () => {
  it("splits a big id list so the request never gets rejected", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    const db = fakeDb((part) => part.map((id) => ({ trip_id: id, status: "paid" })));
    const rows = await selectIn(db, "billing_records", "trip_id, status", "trip_id", ids);
    expect(rows).toHaveLength(1000);
    expect(db.seen.every((p: string[]) => p.length <= 150)).toBe(true);
  });

  it("throws instead of silently returning zero rows when a read fails", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
    const db = fakeDb(() => [], 0);
    await expect(selectIn(db, "billing_records", "*", "trip_id", ids)).rejects.toThrow(/lookup failed/);
  });

  it("de-duplicates and short-circuits on an empty list", async () => {
    const db = fakeDb((part) => part.map((id) => ({ id })));
    expect(await selectIn(db, "t", "*", "id", [])).toEqual([]);
    const rows = await selectIn(db, "t", "*", "id", ["a", "a", "b"]);
    expect(rows).toHaveLength(2);
  });

  it("pages past the 1000-row API ceiling", async () => {
    const total = 2345;
    const build = () => ({
      range: (from: number, to: number) =>
        Promise.resolve({
          data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({
            id: from + i,
          })),
          error: null,
        }),
    });
    const rows = await selectAllPages(build);
    expect(rows).toHaveLength(total);
  });

  it("chunk() respects the size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
