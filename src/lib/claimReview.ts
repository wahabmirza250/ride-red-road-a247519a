/**
 * Shared (client-safe) types + normalizer for the claim data the HCPF robot
 * reads back off the portal during PASS 1 (capture). Pure functions only —
 * imported by both server functions and the review UI.
 */

export type CapturedServiceLine = {
  procedure_code: string;
  place_of_service: string;
  charge_amount: number | null;
  units: number | null;
};

export type CapturedClaim = {
  member_id: string;
  member_name: string;
  diagnosis_code: string;
  service_lines: CapturedServiceLine[];
  total_charged_amount: number | null;
  captured_at?: string | null;
};

function str(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function num(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const cleaned = v.replace(/[^0-9.\-]/g, "");
      if (cleaned) {
        const n = Number(cleaned);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

/**
 * Accepts the many shapes the robot may return (`result.captured`,
 * `result.claim`, `result.claim_data`, or the result itself) and produces one
 * normalized claim. Returns null when nothing usable was returned.
 */
export function normalizeCapturedClaim(input: unknown): CapturedClaim | null {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, any>;
  const src: Record<string, any> =
    root.captured ?? root.claim ?? root.claim_data ?? root.captured_claim ?? root;
  if (!src || typeof src !== "object") return null;

  const rawLines: unknown[] = Array.isArray(src.service_lines)
    ? src.service_lines
    : Array.isArray(src.lines)
      ? src.lines
      : Array.isArray(src.services)
        ? src.services
        : [];

  const service_lines: CapturedServiceLine[] = rawLines
    .filter((l): l is Record<string, any> => !!l && typeof l === "object")
    .map((l) => ({
      procedure_code: str(l.procedure_code, l.procedureCode, l.proc_code, l.cpt, l.code),
      place_of_service: str(l.place_of_service, l.placeOfService, l.pos),
      charge_amount: num(l.charge_amount, l.chargeAmount, l.charge, l.amount),
      units: num(l.units, l.unit, l.quantity, l.qty),
    }));

  const member_id = str(src.member_id, src.memberId, src.medicaid_member_id, src.member_number);
  const member_name = str(src.member_name, src.memberName, src.member_full_name, src.name);
  const diagnosis_code = str(src.diagnosis_code, src.diagnosisCode, src.diagnosis, src.dx_code);
  const total =
    num(src.total_charged_amount, src.totalChargedAmount, src.total_charge, src.total) ??
    (service_lines.length
      ? service_lines.reduce((sum, l) => sum + (l.charge_amount ?? 0), 0)
      : null);

  if (!member_id && !member_name && !diagnosis_code && service_lines.length === 0) {
    return null;
  }

  return {
    member_id,
    member_name,
    diagnosis_code,
    service_lines,
    total_charged_amount: total,
  };
}

/** Pull the portal's confirmation / receipt number out of a PASS 2 result. */
export function extractConfirmationNumber(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, any>;
  const candidates = [
    root.confirmation_number,
    root.confirmationNumber,
    root.receipt_number,
    root.receiptNumber,
    root.claim_number,
    root.claimNumber,
    root.claim_id,
    root.claimId,
    root.tcn,
    root.captured?.confirmation_number,
    root.result?.confirmation_number,
    root.result?.claim_id,
    root.post_confirm_dump?.claim_id,
    root.result?.post_confirm_dump?.claim_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  // Last resort: the receipt page text ("The Claim ID is 9426213001270.")
  const texts = [
    root.post_confirm_dump?.bodyTextFull,
    root.post_confirm_dump?.bodyTextSnippet,
    root.result?.post_confirm_dump?.bodyTextFull,
    root.result?.post_confirm_dump?.bodyTextSnippet,
    root.message,
    root.result?.message,
  ];
  for (const t of texts) {
    if (typeof t !== "string") continue;
    const m = t.match(/Claim\s*ID\s*is\s*([0-9A-Za-z-]{6,})/i) ?? t.match(/Claim\s*ID[:\s]+([0-9]{8,})/i);
    if (m?.[1]) return m[1].replace(/[.,;]$/, "");
  }
  return null;
}


export function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
