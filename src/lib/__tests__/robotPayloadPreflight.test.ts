import { describe, expect, it } from "vitest";
import {
  formatRobotPreflightFailure,
  normalizeRobotPayloadContract,
  validateRobotPayloadPreflight,
} from "@/lib/robotPayload";

const complete = {
  provider_id: "provider-1",
  company_id: "company-1",
  portal_id: "hcpf",
  medicaid_member_id: "A123456",
  patient_number: "A123456",
  service_date: "08/12/2026",
  signature_on_file_state: "yes",
  payer: "Medicaid",
  date_type: "service",
  vehicle_type: "ambulatory",
  diagnosis_code: "R688",
};

describe("robot payload preflight", () => {
  it("blocks a missing trip/service date", () => {
    const result = validateRobotPayloadPreflight({ ...complete, service_date: "" }, { doesSubmit: true });
    expect(result.ok).toBe(false);
    expect(formatRobotPreflightFailure(result)).toMatch(/trip\/service date is missing/i);
  });

  it("blocks a missing Medicaid member ID", () => {
    const result = validateRobotPayloadPreflight(
      { ...complete, medicaid_member_id: "", member_id: "", medicaid_id: "" },
      { doesSubmit: true },
    );
    expect(result.ok).toBe(false);
    expect(formatRobotPreflightFailure(result)).toMatch(/Medicaid member ID is missing/i);
  });

  it("blocks an unresolved signature-on-file state", () => {
    const result = validateRobotPayloadPreflight(
      { ...complete, signature_on_file_state: "", signature_captured: undefined },
      { doesSubmit: true },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.field)).toContain("signature_on_file_state");
  });

  it("blocks missing provider and company mapping", () => {
    const result = validateRobotPayloadPreflight(
      { ...complete, provider_id: "", company_id: "" },
      { doesSubmit: true },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.field)).toEqual(expect.arrayContaining(["provider_id", "company_id"]));
  });

  it("normalizes legacy aliases into the canonical contract", () => {
    const normalized = normalizeRobotPayloadContract({
      providerId: "provider-legacy",
      companyId: "company-legacy",
      portalId: "portal-legacy",
      member_id: "M123456",
      patient_account_number: "M123456",
      from_date: "08/11/2026",
      provider_signature_on_file: true,
      claim_payer: "Medicaid",
      service_date_type: "service",
      vehicleType: "wheelchair_van",
      dx_code: "R688",
    });
    expect(normalized).toMatchObject({
      provider_id: "provider-legacy",
      company_id: "company-legacy",
      portal_id: "portal-legacy",
      medicaid_member_id: "M123456",
      patient_number: "M123456",
      service_date: "08/11/2026",
      signature_on_file_state: "yes",
      payer: "Medicaid",
      date_type: "service",
      vehicle_type: "wheelchair_van",
      diagnosis_code: "R688",
    });
    expect(validateRobotPayloadPreflight(normalized, { doesSubmit: true }).ok).toBe(true);
  });

  it("blocks a patient number that does not match the Medicaid member ID", () => {
    const result = validateRobotPayloadPreflight(
      { ...complete, medicaid_member_id: "B351105", patient_number: "internal-trip-id" },
      { doesSubmit: true },
    );
    expect(result.ok).toBe(false);
    expect(formatRobotPreflightFailure(result)).toMatch(/Patient Number must match the Medicaid Member ID/i);
  });
});