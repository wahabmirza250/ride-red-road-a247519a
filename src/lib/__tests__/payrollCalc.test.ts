import { describe, expect, it } from "vitest";
import {
  computePay,
  payableHours,
  payoutsInPeriod,
  pendingFuel,
  periodsOverlap,
  round2,
  shiftHours,
  shiftInPeriod,
} from "@/lib/payrollCalc";

const FROM = "2026-01-01T00:00:00.000Z";
const TO = "2026-01-14T23:59:59.999Z";

const shift = (o: Partial<Parameters<typeof payableHours>[0][number]> = {}) => ({
  id: o.id ?? crypto.randomUUID(),
  driver_id: "d1",
  clock_in_at: o.clock_in_at ?? "2026-01-05T09:00:00.000Z",
  clock_out_at: o.clock_out_at ?? "2026-01-05T17:00:00.000Z",
  payout_id: o.payout_id ?? null,
});

describe("shift hours", () => {
  it("computes exact hours and never goes negative", () => {
    expect(shiftHours("2026-01-05T09:00:00Z", "2026-01-05T17:30:00Z")).toBe(8.5);
    expect(shiftHours("2026-01-05T17:00:00Z", "2026-01-05T09:00:00Z")).toBe(0);
  });

  it("measures an open shift against the supplied clock only", () => {
    const now = new Date("2026-01-05T12:00:00Z");
    expect(shiftHours("2026-01-05T09:00:00Z", null, now)).toBe(3);
  });
});

describe("pay period boundaries", () => {
  it("includes shifts starting exactly on either edge", () => {
    expect(shiftInPeriod(shift({ clock_in_at: FROM }), FROM, TO)).toBe(true);
    expect(shiftInPeriod(shift({ clock_in_at: TO }), FROM, TO)).toBe(true);
  });

  it("excludes a shift starting one millisecond before or after", () => {
    expect(shiftInPeriod(shift({ clock_in_at: "2025-12-31T23:59:59.999Z" }), FROM, TO)).toBe(false);
    expect(shiftInPeriod(shift({ clock_in_at: "2026-01-15T00:00:00.000Z" }), FROM, TO)).toBe(false);
  });
});

describe("payable hours", () => {
  it("sums closed unpaid shifts only, and reports open ones separately", () => {
    const r = payableHours(
      [
        shift({ id: "a" }), // 8h
        shift({ id: "b", clock_in_at: "2026-01-06T09:00:00Z", clock_out_at: "2026-01-06T13:00:00Z" }), // 4h
        shift({ id: "c", clock_out_at: null }), // still running
        shift({ id: "d", payout_id: "already-paid" }), // never payable twice
        shift({ id: "e", clock_in_at: "2026-02-01T09:00:00Z" }), // out of period
      ],
      FROM,
      TO,
    );
    expect(r.hours).toBe(12);
    expect(r.shiftIds).toEqual(["a", "b"]);
    expect(r.openCount).toBe(1);
  });

  it("returns nothing when every shift is already linked to a payout", () => {
    const r = payableHours([shift({ payout_id: "p1" }), shift({ payout_id: "p2" })], FROM, TO);
    expect(r).toEqual({ hours: 0, shiftIds: [], openCount: 0 });
  });
});

describe("fuel", () => {
  const receipt = (o: Record<string, unknown>) => ({
    id: "r",
    driver_id: "d1",
    amount: 25,
    submitted_at: "2026-01-04T10:00:00Z",
    reimbursed_at: null,
    payout_id: null,
    ...o,
  });

  it("only counts unreimbursed, unlinked receipts inside the period", () => {
    const r = pendingFuel(
      [
        receipt({ id: "a", amount: "20.5" }),
        receipt({ id: "b", reimbursed_at: "2026-01-05T00:00:00Z" }),
        receipt({ id: "c", payout_id: "p1" }),
        receipt({ id: "d", submitted_at: "2026-03-01T10:00:00Z" }),
      ],
      FROM,
      TO,
    );
    expect(r.amount).toBe(20.5);
    expect(r.receiptIds).toEqual(["a"]);
  });
});

describe("computePay", () => {
  it("is deterministic and cent-exact", () => {
    const a = computePay({ hours: 12.33, hourly_rate: 21.37, fuel: 10.115, bonus: 5 });
    const b = computePay({ hours: 12.33, hourly_rate: 21.37, fuel: 10.115, bonus: 5 });
    expect(a).toEqual(b);
    expect(a.gross_earnings).toBe(263.49);
    expect(a.total).toBe(a.gross_earnings! + a.fuel + a.bonus);
    expect(round2(a.total!)).toBe(a.total);
  });

  it("returns no total when the driver has no rate", () => {
    expect(computePay({ hours: 10, hourly_rate: null, fuel: 30 }).total).toBeNull();
  });

  it("drops fuel when it is excluded from the payment", () => {
    const c = computePay({ hours: 10, hourly_rate: 20, fuel: 30, include_fuel: false });
    expect(c.fuel).toBe(0);
    expect(c.total).toBe(200);
  });

  it("supports a negative adjustment (deduction)", () => {
    expect(computePay({ hours: 10, hourly_rate: 20, fuel: 0, bonus: -25 }).total).toBe(175);
  });
});

describe("duplicate / double-pay prevention", () => {
  const payout = (o: Record<string, unknown>) => ({
    driver_id: "d1",
    total_paid: 100,
    paid_at: "2026-01-15T00:00:00Z",
    period_start: FROM,
    period_end: TO,
    voided_at: null,
    ...o,
  });

  it("detects overlapping periods, including touching edges", () => {
    expect(periodsOverlap(FROM, TO, "2026-01-14T00:00:00Z", "2026-01-28T00:00:00Z")).toBe(true);
    expect(periodsOverlap(FROM, TO, "2026-01-15T00:00:00Z", "2026-01-28T00:00:00Z")).toBe(false);
  });

  it("ignores voided payouts when checking what was already paid", () => {
    const live = payoutsInPeriod(
      [payout({}), payout({ voided_at: "2026-01-16T00:00:00Z" })],
      FROM,
      TO,
    );
    expect(live).toHaveLength(1);
  });

  it("counts a payout whose period only partially overlaps the window", () => {
    const live = payoutsInPeriod(
      [payout({ period_start: "2025-12-20T00:00:00Z", period_end: "2026-01-03T00:00:00Z" })],
      FROM,
      TO,
    );
    expect(live).toHaveLength(1);
  });
});
