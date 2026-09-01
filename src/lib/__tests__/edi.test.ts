import { describe, expect, it } from "vitest";
import { ediErrorMessage, ediIsValid, ediStatusTone, ediValidationIssues, hasEdiClaim, ediClaimId } from "@/lib/edi";

describe("edi helpers", () => {
  it("only treats real claim ids as linked", () => {
    expect(hasEdiClaim({ edi_claim_id: 12 })).toBe(true);
    expect(hasEdiClaim({ edi_claim_id: 0 })).toBe(false);
    expect(hasEdiClaim({ edi_claim_id: null })).toBe(false);
    expect(hasEdiClaim(null)).toBe(false);
    expect(ediClaimId({ edi_claim_id: "44" })).toBe(44);
  });

  it("preserves backend error detail", () => {
    expect(ediErrorMessage({ detail: "Claim not found" })).toBe("Claim not found");
    expect(ediErrorMessage({ charge_amount: ["Must be a decimal"] })).toContain("charge_amount");
    expect(ediErrorMessage(null)).toBe("EDI backend unavailable");
  });

  it("classifies status tone", () => {
    expect(ediStatusTone("ACCEPTED")).toBe("ok");
    expect(ediStatusTone("rejected")).toBe("error");
    expect(ediStatusTone("pending")).toBe("warn");
    expect(ediStatusTone(null)).toBe("idle");
  });

  it("flattens validation payloads", () => {
    const issues = ediValidationIssues({ errors: ["bad NPI"], warnings: [{ code: "W1", message: "check" }] });
    expect(issues).toHaveLength(2);
    expect(issues[0]!.severity).toBe("error");
    expect(ediIsValid({ is_valid: false })).toBe(false);
    expect(ediIsValid(null)).toBe(null);
  });

  it("reads readiness and validation_errors from the guide payload", () => {
    expect(ediIsValid({ ready: true })).toBe(true);
    expect(ediIsValid({ ready: false, validation_errors: ["missing NPI"] })).toBe(false);
    const issues = ediValidationIssues({ validation_errors: [{ code: "E1", message: "missing NPI" }] });
    expect(issues).toEqual([{ code: "E1", message: "missing NPI", severity: "error" }]);
  });
});
