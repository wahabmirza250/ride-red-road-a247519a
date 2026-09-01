import { describe, expect, it } from "vitest";
import {
  isVerifiableCorrectedCode,
  pickCorrectedMatch,
} from "@/lib/correctedVerify";
import type { PortalClaim } from "@/lib/hcpfSearch";

const claim = (id: string, extra: Partial<PortalClaim> = {}): PortalClaim => ({
  claim_id: id,
  status: "PAID",
  service_date: "08/10/2026",
  paid_amount: 54.8,
  charge_amount: 104.12,
  units: 10,
  member_id: "G645382",
  ...extra,
});

describe("verifiable hold codes", () => {
  it("covers the ambiguous / lost / ceiling holds only", () => {
    expect(isVerifiableCorrectedCode("corrected_outcome_unverified")).toBe(true);
    expect(isVerifiableCorrectedCode("corrected_job_lost_unverified")).toBe(true);
    expect(isVerifiableCorrectedCode("corrected_inflight_ceiling_unverified")).toBe(true);
    expect(isVerifiableCorrectedCode("corrected_original_claim_reused")).toBe(false);
    expect(isVerifiableCorrectedCode(null)).toBe(false);
  });
});

describe("corrected match safety", () => {
  it("accepts exactly one new unused claim", () => {
    const m = pickCorrectedMatch({ claims: [claim("2326239001999")], originalClaimNumber: "2326239001864" });
    expect(m.kind).toBe("unique");
    if (m.kind === "unique") expect(m.claim.claim_id).toBe("2326239001999");
  });
  it("never accepts the original denied claim", () => {
    const m = pickCorrectedMatch({ claims: [claim("2326239001864")], originalClaimNumber: "2326239001864" });
    expect(m.kind).toBe("none");
  });
  it("never accepts a claim already used by another bill", () => {
    const m = pickCorrectedMatch({
      claims: [claim("2326239001999")],
      originalClaimNumber: "2326239001864",
      usedClaimNumbers: ["2326239001999"],
    });
    expect(m.kind).toBe("none");
  });
  it("never accepts a claim flagged as linked by the search", () => {
    const m = pickCorrectedMatch({
      claims: [claim("2326239001999", { linked: { billing_record_id: "x" } as any })],
      originalClaimNumber: "2326239001864",
    });
    expect(m.kind).toBe("none");
  });
  it("holds when more than one new claim exists", () => {
    const m = pickCorrectedMatch({
      claims: [claim("111"), claim("222")],
      originalClaimNumber: "2326239001864",
    });
    expect(m.kind).toBe("multiple");
    if (m.kind === "multiple") expect(m.claims).toHaveLength(2);
  });
  it("holds when the portal returned nothing", () => {
    expect(pickCorrectedMatch({ claims: [], originalClaimNumber: "x" }).kind).toBe("none");
  });
  it("picks the new claim when the original is also returned", () => {
    const m = pickCorrectedMatch({
      claims: [claim("2326239001864"), claim("2326239001999")],
      originalClaimNumber: "2326239001864",
    });
    expect(m.kind).toBe("unique");
  });
});
