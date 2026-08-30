import { describe, expect, it } from "vitest";
import { decideLink, friendlyLinkError, parseClaimConflict, claimConflictError, CLAIM_CONFLICT_MESSAGE, type PortalClaim, type LinkedBill } from "@/lib/hcpfSearch";
import { normalizeClaims } from "@/lib/hcpfSearch.server";

const claim = (id: string, linked?: LinkedBill | null): PortalClaim => ({
  claim_id: id, status: "PAID", service_date: "08/06/2026", paid_amount: 20, charge_amount: 25,
  units: 10, member_id: "P493288", linked: linked ?? null,
});

const bill: LinkedBill = {
  billing_record_id: "66ff8cfa-333a-4e4a-9d9f-7c487b0b5390",
  trip_id: "14ce02ae-aada-49a4-93d1-e720be7dca91",
  status: "paid", passenger_name: "A", medicaid_id: "P493288",
  service_date: "2026-08-06", odometer_start: 1, odometer_end: 2, miles: 1,
};

describe("safe matching", () => {
  it("links only one unassigned claim with one same-day trip", () => {
    expect(decideLink({ claims: [claim("1")], sameDayTripCount: 1 }).kind).toBe("auto");
  });
  it("never auto-links with multiple same-day trips", () => {
    expect(decideLink({ claims: [claim("1")], sameDayTripCount: 2 }).kind).toBe("manual");
  });
  it("never auto-links with multiple portal claims", () => {
    expect(decideLink({ claims: [claim("1"), claim("2")], sameDayTripCount: 1 }).kind).toBe("manual");
  });
  it("never auto-links a claim already linked elsewhere", () => {
    expect(decideLink({ claims: [claim("2326240001014", bill)], sameDayTripCount: 1 }).kind).toBe("manual");
  });
  it("reports zero claims", () => {
    expect(decideLink({ claims: [], sameDayTripCount: 1 }).kind).toBe("none");
  });
});

describe("friendly errors", () => {
  it("hides raw unique-constraint SQL", () => {
    expect(
      friendlyLinkError(
        new Error('duplicate key value violates unique constraint "billing_records_company_confirmation_uniq"'),
      ),
    ).toBe(CLAIM_CONFLICT_MESSAGE);
  });
  it("round-trips a structured conflict", () => {
    const parsed = parseClaimConflict(claimConflictError(bill, "2326240001014"));
    expect(parsed?.claim).toBe("2326240001014");
    expect(parsed?.bill.billing_record_id).toBe(bill.billing_record_id);
  });
});

describe("claim normalization", () => {
  it("lists every claim, not just one", () => {
    const rows = normalizeClaims({ claims: [{ claim_id: "a" }, { icn: "b", paid_amount: "$12.50" }, { claim_id: "a" }] });
    expect(rows.map((r) => r.claim_id)).toEqual(["a", "b"]);
    expect(rows[1]!.paid_amount).toBe(12.5);
  });
});
