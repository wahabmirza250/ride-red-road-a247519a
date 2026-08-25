/**
 * Internal manual trips ("+ Add Manual Trip" in Claim History).
 *
 * These records exist ONLY inside RedArt. They are stored in
 * `manual_claim_records`, a table that no submission, queue, retry,
 * reconciliation or robot code path ever reads or writes. A manual trip can
 * therefore never be sent to HCPF — it exists so a trip handled outside the
 * automated flow can still be paid to the driver through payroll.
 *
 * The driver pay amount is entered by a human and is used VERBATIM when the
 * record is added to payroll; pay plans are never applied to it.
 */

export const MANUAL_CLAIM_SOURCE = "manual_entry" as const;

/** Free-form statuses a biller may record for an internal manual trip. */
export const MANUAL_CLAIM_STATUS_OPTIONS = [
  "internal",
  "paid",
  "billed_elsewhere",
  "unpaid",
] as const;
export type ManualClaimStatus = (typeof MANUAL_CLAIM_STATUS_OPTIONS)[number];

export const MANUAL_CLAIM_STATUS_LABEL: Record<string, string> = {
  internal: "Internal",
  paid: "Paid",
  billed_elsewhere: "Billed elsewhere",
  unpaid: "Unpaid",
};

export type ManualClaimInput = {
  driver_id?: string | null;
  passenger_name?: string | null;
  service_date?: string | null;
  claim_number?: string | null;
  billed_amount?: number | null;
  driver_pay_amount?: number | null;
  claim_status?: string | null;
  notes?: string | null;
};

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A manual trip must identify a driver, a passenger, a date and a
 * non-negative driver pay amount. Negative pay is rejected: deductions belong
 * in a payroll adjustment, not in a trip record.
 */
export function validateManualClaim(
  input: ManualClaimInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.driver_id) return { ok: false, error: "Pick a driver." };
  if (!input.passenger_name?.trim())
    return { ok: false, error: "Enter the passenger / client name." };
  if (!input.service_date) return { ok: false, error: "Pick a trip / service date." };
  const pay = Number(input.driver_pay_amount);
  if (!Number.isFinite(pay) || pay < 0)
    return { ok: false, error: "Driver pay amount must be zero or more." };
  if (input.billed_amount != null && input.billed_amount !== ("" as never)) {
    const billed = Number(input.billed_amount);
    if (!Number.isFinite(billed) || billed < 0)
      return { ok: false, error: "Amount billed must be zero or more." };
  }
  return { ok: true };
}

export type ManualClaimRecord = {
  id: string;
  company_id: string | null;
  driver_id: string;
  passenger_name: string;
  service_date: string;
  claim_number: string | null;
  billed_amount: number | null;
  driver_pay_amount: number | null;
  claim_status: string | null;
  notes: string | null;
  created_at: string;
};

/**
 * The payroll line built from a manual trip. The amount is the biller's
 * entered driver pay amount, rounded to cents — never recalculated.
 */
export function manualPayrollLine(
  rec: Pick<
    ManualClaimRecord,
    "id" | "company_id" | "driver_id" | "passenger_name" | "service_date" | "claim_number" | "driver_pay_amount"
  >,
  actorId: string,
) {
  return {
    company_id: rec.company_id,
    driver_id: rec.driver_id,
    kind: "manual" as const,
    ref_id: rec.id,
    service_date: rec.service_date ? String(rec.service_date).slice(0, 10) : null,
    passenger_name: rec.passenger_name,
    description: "Manual trip (entered in Claim History)",
    category: "manual_trip",
    amount: round2(rec.driver_pay_amount ?? 0),
    payroll_status: "added" as const,
    claim_number: rec.claim_number ?? null,
    created_by: actorId,
  };
}
