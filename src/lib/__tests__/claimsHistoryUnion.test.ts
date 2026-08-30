import { describe, expect, it } from "vitest";
import {
  claimKey,
  dedupeClaimHistory,
  matchesClaimSearch,
  normalizeClaimNumber,
  type ClaimHistoryRow,
} from "@/lib/claimsHistory";
import { aggregateEarnings } from "@/lib/earnings";
import { claimSanityIssues, isClaimSane, MAX_CLAIM_MILES } from "@/lib/claimSanity";

const row = (over: Partial<ClaimHistoryRow>): ClaimHistoryRow => ({
  id: over.id ?? "t1",
  company_id: "co-1",
  source: "portal",
  claim_id: null,
  member_name: null,
  medicaid_id: null,
  trip_date: null,
  submitted_at: null,
  total_amount: null,
  total_source: null,
  status: "submitted",
  ...over,
});

/** The three production claims that vanished from Claims History. */
const EXAMPLES = [
  { claim: "2326238001728", member: "Sierra Brown", paid: 24.3, charged: 24665.12 },
  { claim: "2326238001741", member: "Nathan W Martin", paid: 95.54, charged: null },
  { claim: "2326241001037", member: "Michael Walker", paid: 95.54, charged: null },
];

describe("claims history is ONE list over both sources", () => {
  it("keeps automated (billing record) and manual rows in the same list", () => {
    const merged = dedupeClaimHistory([
      row({ id: "t1", record_id: "br-1", claim_id: "2326238001728", source: "portal" }),
      row({ id: "m1", claim_id: "MANUAL-9", source: "manual", company_id: "co-1" }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.source).sort()).toEqual(["manual", "portal"]);
  });

  it("deduplicates on company + claim number, keeping the richer row", () => {
    const merged = dedupeClaimHistory([
      row({ id: "t1", claim_id: "2326238001728" }),
      row({ id: "t1", record_id: "br-1", claim_id: "2326238001728", portal_paid_amount: 24.3 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.portal_paid_amount).toBe(24.3);
    expect(merged[0]!.record_id).toBe("br-1");
  });

  it("does not merge the same claim number across different companies", () => {
    const merged = dedupeClaimHistory([
      row({ id: "a", company_id: "co-1", claim_id: "2326238001728" }),
      row({ id: "b", company_id: "co-2", claim_id: "2326238001728" }),
    ]);
    expect(merged).toHaveLength(2);
    expect(claimKey({ company_id: "co-1", claim_id: " 2326238001728 " })).toBe(
      "co-1|2326238001728",
    );
  });

  it.each(EXAMPLES)("finds $claim by exact claim number or member name", (ex) => {
    const r = row({ claim_id: ex.claim, member_name: ex.member, portal_paid_amount: ex.paid });
    expect(matchesClaimSearch(r, ex.claim)).toBe(true);
    expect(matchesClaimSearch(r, ` ${ex.claim} `)).toBe(true);
    expect(matchesClaimSearch(r, ex.member.split(" ")[0]!)).toBe(true);
    expect(matchesClaimSearch(r, "9999999999")).toBe(false);
    expect(normalizeClaimNumber(ex.claim)).toBe(ex.claim);
  });
});

describe("financial totals never invent income", () => {
  it("paid income is the portal-paid amount, not the calculated charge", () => {
    const out = aggregateEarnings([
      {
        robot_captured_claim: null,
        amount: 24665.12, // corrupt calculated mileage charge
        billing_status: "paid",
        portal_paid_amount: 24.3,
        submitted_at: "2026-08-25T10:00:00Z",
      },
    ]);
    expect(out.total).toBe(24.3);
    expect(out.claims).toBe(1);
    expect(out.byDay[0]!.amount).toBe(24.3);
  });

  it("a paid claim with no portal amount is unverified, never income", () => {
    const out = aggregateEarnings([
      {
        robot_captured_claim: null,
        amount: 24665.12,
        billing_status: "paid",
        portal_paid_amount: null,
        submitted_at: "2026-08-25T10:00:00Z",
      },
    ]);
    expect(out.total).toBe(0);
    expect(out.unknownClaims).toBe(1);
    expect(out.pendingTotal).toBe(0);
  });

  it("needs_fix and denied bills are excluded from awaiting payment", () => {
    const out = aggregateEarnings([
      { robot_captured_claim: null, amount: 100, billing_status: "needs_fix", submitted_at: "2026-08-25T10:00:00Z" },
      { robot_captured_claim: null, amount: 100, billing_status: "denied", submitted_at: "2026-08-25T10:00:00Z" },
      { robot_captured_claim: null, amount: 95.54, billing_status: "submitted", submitted_at: "2026-08-25T10:00:00Z" },
    ]);
    expect(out.pendingTotal).toBe(95.54);
    expect(out.pendingClaims).toBe(1);
    expect(out.deniedClaims).toBe(1);
    expect(out.unknownClaims).toBe(1);
    expect(out.total).toBe(0);
  });
});

describe("corrupt claims stay out of automatic submission", () => {
  it("flags mileage beyond the allowed range", () => {
    expect(isClaimSane({ billed_miles: 12 })).toBe(true);
    expect(isClaimSane({ billed_miles: MAX_CLAIM_MILES })).toBe(true);
    expect(isClaimSane({ billed_miles: 16_432 })).toBe(false);
    expect(isClaimSane({ billed_miles: 0 })).toBe(false);
  });

  it("flags future, unparseable and very old service dates", () => {
    const now = new Date("2026-08-30T00:00:00Z");
    expect(isClaimSane({ service_date: "2026-08-25T10:00:00Z" }, now)).toBe(true);
    expect(claimSanityIssues({ service_date: "2027-01-01T00:00:00Z" }, now)[0]?.code).toBe(
      "future_service_date",
    );
    expect(claimSanityIssues({ service_date: "not a date" }, now)[0]?.code).toBe(
      "invalid_service_date",
    );
    expect(claimSanityIssues({ service_date: "2020-01-01T00:00:00Z" }, now)[0]?.code).toBe(
      "stale_service_date",
    );
  });
});
