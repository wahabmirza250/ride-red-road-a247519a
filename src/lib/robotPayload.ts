export type RobotPayloadPreflightIssue = {
  field: string;
  message: string;
};

export type RobotPayloadPreflightResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: RobotPayloadPreflightIssue[] };

export type NormalizedRobotPayloadContract = {
  provider_id: string;
  company_id: string;
  portal_id: string;
  medicaid_member_id: string;
  patient_number: string;
  service_date: string;
  signature_on_file_state: "yes" | "no" | "unknown";
  payer: string;
  date_type: string;
  vehicle_type: string;
  diagnosis_code: string;
};

function str(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function signatureState(value: unknown): "yes" | "no" | "unknown" {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value !== "string") return "unknown";
  const s = value.trim().toLowerCase();
  if (["yes", "y", "true", "1", "on", "captured"].includes(s)) return "yes";
  if (["no", "n", "false", "0", "off", "missing"].includes(s)) return "no";
  return "unknown";
}

function isValidMdy(value: string): boolean {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return false;
  const d = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`);
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}

export function normalizeRobotPayloadContract(input: Record<string, unknown>): NormalizedRobotPayloadContract {
  const medicaidMemberId = str(
    input.medicaid_member_id,
    input.member_id,
    input.medicaid_id,
    input.memberId,
  );
  return {
    provider_id: str(input.provider_id, input.providerId),
    company_id: str(input.company_id, input.companyId),
    portal_id: str(input.portal_id, input.portalId),
    medicaid_member_id: medicaidMemberId,
    patient_number: str(
      input.patient_number,
      input.patient_account_number,
      input.patient_id,
      input.portal_patient_number,
      input.trip_id,
      input.id,
    ),
    service_date: str(
      input.service_date_mdy,
      input.trip_date,
      input.service_date,
      input.date_of_service,
      input.from_date,
    ),
    signature_on_file_state: signatureState(
      input.signature_on_file_state ??
        input.provider_signature_on_file_state ??
        input.provider_has_signature_on_file_state ??
        input.signature_on_file ??
        input.provider_signature_on_file ??
        input.provider_has_signature_on_file ??
        input.signature_captured,
    ),
    payer: str(input.payer, input.payer_type, input.claim_payer, input.insurance_type),
    date_type: str(input.date_type, input.date_type_code, input.service_date_type),
    vehicle_type: str(input.vehicle_type, input.vehicleType),
    diagnosis_code: str(
      input.diagnosis_code,
      input.primary_diagnosis_code,
      input.primary_diagnosis,
      input.diagnosis,
      input.dx_code,
      input.icd10_code,
      input.icd_code,
    ),
  };
}

export function validateRobotPayloadPreflight(
  input: Record<string, unknown>,
  opts: { doesSubmit?: boolean } = {},
): RobotPayloadPreflightResult {
  const p = normalizeRobotPayloadContract(input);
  const issues: RobotPayloadPreflightIssue[] = [];
  const required = (field: keyof NormalizedRobotPayloadContract, message: string) => {
    if (!p[field]) issues.push({ field, message });
  };

  required("provider_id", "Submission blocked: no provider account was resolved for this bill.");
  required("company_id", "Submission blocked: no company is linked to this bill.");
  required("portal_id", "Submission blocked: no portal login is configured for this company.");
  required("medicaid_member_id", "Submission blocked: Medicaid member ID is missing.");
  required("patient_number", "Submission blocked: Patient Number / Medicaid Member ID is missing.");
  required("service_date", "Submission blocked: trip/service date is missing.");
  required("payer", "Submission blocked: payer selection is missing.");
  required("date_type", "Submission blocked: service date type is missing.");
  required("vehicle_type", "Submission blocked: vehicle type is missing.");
  required("diagnosis_code", "Submission blocked: diagnosis code is missing in Billing Settings.");

  if (p.service_date && !isValidMdy(p.service_date)) {
    issues.push({ field: "service_date", message: `Submission blocked: service date ${p.service_date} is invalid.` });
  }
  if (p.signature_on_file_state === "unknown") {
    issues.push({ field: "signature_on_file_state", message: "Submission blocked: signature-on-file must be explicit yes or no." });
  } else if (opts.doesSubmit && p.signature_on_file_state !== "yes") {
    issues.push({ field: "signature_on_file_state", message: "Submission blocked: this trip has no signed report on file." });
  }
  if (p.medicaid_member_id && p.patient_number && p.medicaid_member_id !== p.patient_number) {
    issues.push({ field: "patient_number", message: "Submission blocked: Patient Number must match the Medicaid Member ID." });
  }

  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

export function formatRobotPreflightFailure(result: RobotPayloadPreflightResult): string {
  if (result.ok) return "Robot payload preflight passed.";
  return result.issues[0]?.message ?? "Submission blocked: required claim data is missing.";
}

export function formatRobotPayloadDiagnostic(input: Record<string, unknown>): Record<string, unknown> {
  const p = normalizeRobotPayloadContract(input);
  return {
    provider_id_present: Boolean(p.provider_id),
    company_id_present: Boolean(p.company_id),
    portal_id_present: Boolean(p.portal_id),
    medicaid_member_id_last4: p.medicaid_member_id ? p.medicaid_member_id.slice(-4) : null,
    patient_number_last4: p.patient_number ? p.patient_number.slice(-4) : null,
    service_date_present: Boolean(p.service_date),
    signature_on_file_state: p.signature_on_file_state,
    payer_present: Boolean(p.payer),
    date_type_present: Boolean(p.date_type),
    vehicle_type: p.vehicle_type || null,
    diagnosis_code_present: Boolean(p.diagnosis_code),
  };
}