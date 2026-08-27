import { describe, it, expect } from "vitest";
import { pageRange, BILLING_PAGE_SIZE, BILLING_MAX_PAGE_SIZE } from "@/lib/billingPage";

describe("billing list paging", () => {
  it("defaults to one page from the start", () => {
    expect(pageRange()).toEqual({ from: 0, to: BILLING_PAGE_SIZE - 1, size: BILLING_PAGE_SIZE });
  });

  it("offsets without changing the page size", () => {
    expect(pageRange(50, 100)).toEqual({ from: 100, to: 149, size: 50 });
  });

  it("clamps absurd or negative inputs", () => {
    expect(pageRange(100000, -5).size).toBe(BILLING_MAX_PAGE_SIZE);
    expect(pageRange(0, -5).from).toBe(0);
    expect(pageRange(0, 0).size).toBe(1);
  });
});
