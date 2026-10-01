import { describe, it, expect } from "vitest";
import { crossCheckPaperReads } from "./paperBillCrossCheck";
const f = (v: unknown, c = 0.99) => ({ v, c });
describe("independent paper readings", () => {
  it("retains matching labeled passenger and driver", () => {
    const read = { name: f("James Pacheco"), driver_name: f("Ariana Aragon") };
    expect(crossCheckPaperReads(read, read).result).toMatchObject(read);
  });
  it("does not accept reversed roles", () => {
    const a = { name: f("Ariana Aragon"), driver_name: f("James Pacheco") };
    const b = { name: f("James Pacheco"), driver_name: f("Ariana Aragon") };
    const out = crossCheckPaperReads(a, b);
    expect(out.conflicts).toEqual(["name", "driver_name"]);
    expect(out.result.name).toEqual(f(null, 0));
    expect(out.result.driver_name).toEqual(f(null, 0));
  });
  it("clears conflicting years, odometers and member IDs without guessing", () => {
    const out = crossCheckPaperReads({ trip_date: f("2024-02-13"), l1p: f("51512"), medicaid_id: f("C425846") }, { trip_date: f("2026-02-13"), l1p: f("171367"), medicaid_id: f("W425846") });
    expect(out.conflicts).toEqual(["medicaid_id", "trip_date", "l1p"]);
    for (const key of out.conflicts) expect(out.result[key]).toEqual(f(null, 0));
  });
  it("preserves agreed fields when another field conflicts", () => {
    const out = crossCheckPaperReads({ name: f("Test Passenger"), l1p: f("1000") }, { name: f("Test Passenger"), l1p: f("1001") });
    expect(out.result.name).toEqual(f("Test Passenger"));
    expect(out.conflicts).toEqual(["l1p"]);
  });
  it("rejects confident guesses missing from the second reading", () => {
    expect(crossCheckPaperReads({ l2p: f("1007") }, {}).result.l2p).toEqual(f(null, 0));
  });
  it("rejects low confidence even when both readings agree", () => {
    expect(crossCheckPaperReads({ name: f("Test", 0.5) }, { name: f("Test") }).result.name).toEqual(f(null, 0));
  });
});
