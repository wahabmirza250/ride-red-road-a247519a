import { describe, it, expect } from "vitest";
import { guardPaperLegs, assertPaperLegReview } from "./paperBillLegGuard";
const f = (v: unknown, c = 0.99) => ({ v, c });
describe("paper leg protection", () => {
  it("discards invented return odometers and times when only one row is completed", () => {
    const result = guardPaperLegs({ completed_legs: f(1), l1p: f("171606"), l1d: f("171613"), l2p: f("176127"), l2d: f("176134"), l2pt: f("12:00 PM"), l2dt: f("12:20 PM") });
    for (const key of ["l2p", "l2d", "l2pt", "l2dt"]) expect(result[key]).toEqual({ v: null, c: 0 });
    expect(result.l1p).toEqual(f("171606"));
  });
  it.each([undefined, f(null), f(3), f(2, 0.6)])("blocks missing or uncertain count %j", completed_legs => {
    expect(() => guardPaperLegs({ completed_legs })).toThrow();
  });
  it("blocks incomplete return evidence", () => {
    expect(() => guardPaperLegs({ completed_legs: f(2), l2p: f("1000"), l2d: f(null) })).toThrow();
  });
  it("retains two clearly filled rows for human review", () => {
    const input = { completed_legs: f(2), l2p: f("1000"), l2d: f("1007") };
    expect(guardPaperLegs(input)).toEqual(input);
  });
  it("requires explicit review even when OCR confidently invents a second leg", () => {
    expect(() => assertPaperLegReview([{}, {}])).toThrow();
    expect(() => assertPaperLegReview([{}, {}], false)).toThrow();
    expect(() => assertPaperLegReview([{}, {}], true)).not.toThrow();
    expect(() => assertPaperLegReview([{}])).not.toThrow();
  });
});
