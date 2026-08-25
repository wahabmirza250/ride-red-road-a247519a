/**
 * Pure payroll-item logic shared by the server functions, the Claim History
 * payroll workflow and the print/PDF layout.
 *
 * IMPORTANT: payroll status is deliberately INDEPENDENT of Medicaid claim
 * status. A claim the state has paid still starts at "Not Added"; only a human
 * moves it to "Added to Payroll" and later to "Paid".
 */

export const PAYROLL_STATUSES = ["not_added", "added", "paid"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  not_added: "Not Added",
  added: "Added to Payroll",
  paid: "Paid",
};

export const PAYROLL_ITEM_KINDS = ["claim", "manual", "adjustment"] as const;
export type PayrollItemKind = (typeof PAYROLL_ITEM_KINDS)[number];

export const MANUAL_CATEGORIES = [
  "manual_trip",
  "bonus",
  "reimbursement",
  "correction",
  "deduction",
  "other",
] as const;
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

export type PayrollItem = {
  id: string;
  driver_id: string;
  kind: PayrollItemKind;
  ref_id: string | null;
  service_date: string | null;
  passenger_name: string | null;
  description: string | null;
  category: string | null;
  amount: number;
  payroll_status: PayrollStatus;
  claim_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Stable idempotency key for a claim-sourced payroll line. */
export const payrollClaimKey = (companyId: string | null, tripId: string) =>
  `payroll:${companyId ?? "none"}:${tripId}`;

/**
 * A negative amount is only ever allowed on an explicit `adjustment`. Claim and
 * manual lines are always positive so existing payout math can never be
 * silently inverted.
 */
export function validateManualItem(input: {
  kind: PayrollItemKind;
  amount: number;
  description?: string | null;
  driver_id?: string | null;
  service_date?: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (!input.driver_id) return { ok: false, error: "Pick a driver." };
  if (!input.service_date) return { ok: false, error: "Pick a service date." };
  if (!input.description?.trim()) return { ok: false, error: "Add a short description." };
  if (!Number.isFinite(input.amount) || input.amount === 0)
    return { ok: false, error: "Enter a non-zero amount." };
  if (input.amount < 0 && input.kind !== "adjustment")
    return { ok: false, error: "Negative amounts must be entered as an Adjustment." };
  return { ok: true };
}

export type DriverPayrollSummary = {
  driver_id: string;
  driver_name: string;
  total_claims: number;
  paid: number;
  submitted: number;
  denied: number;
  needs_attention: number;
  eligible_amount: number;
  already_paid_amount: number;
  remaining_amount: number;
};

export type SummaryRow = {
  driver_id: string | null;
  driver_name: string | null;
  claim_status: string | null;
  payroll_status: PayrollStatus | null;
  driver_pay_amount: number | null;
};

const DENIED = new Set(["denied", "rejected"]);
const ATTENTION = new Set(["needs_fix", "suspended", "needs_attention"]);

/** Per-driver rollup shown above the Claim History payroll table. */
export function summarizeByDriver(rows: SummaryRow[]): DriverPayrollSummary[] {
  const out = new Map<string, DriverPayrollSummary>();
  for (const r of rows) {
    const key = r.driver_id ?? r.driver_name ?? "unassigned";
    const s =
      out.get(key) ??
      ({
        driver_id: r.driver_id ?? key,
        driver_name: r.driver_name ?? "Unassigned",
        total_claims: 0,
        paid: 0,
        submitted: 0,
        denied: 0,
        needs_attention: 0,
        eligible_amount: 0,
        already_paid_amount: 0,
        remaining_amount: 0,
      } satisfies DriverPayrollSummary);

    s.total_claims += 1;
    const cs = (r.claim_status ?? "").toLowerCase();
    if (cs === "paid") s.paid += 1;
    else if (cs === "submitted" || cs === "approved") s.submitted += 1;
    if (DENIED.has(cs)) s.denied += 1;
    if (ATTENTION.has(cs)) s.needs_attention += 1;

    const amount = round2(r.driver_pay_amount ?? 0);
    if (r.payroll_status === "paid") s.already_paid_amount = round2(s.already_paid_amount + amount);
    else if (r.payroll_status === "added")
      s.remaining_amount = round2(s.remaining_amount + amount);
    else s.eligible_amount = round2(s.eligible_amount + amount);

    out.set(key, s);
  }
  return [...out.values()].sort((a, b) => a.driver_name.localeCompare(b.driver_name));
}

/** Totals for one printed payroll statement. */
export function statementTotals(items: Pick<PayrollItem, "kind" | "amount">[]) {
  let earnings = 0;
  let adjustments = 0;
  for (const i of items) {
    if (i.kind === "adjustment") adjustments = round2(adjustments + Number(i.amount || 0));
    else earnings = round2(earnings + Number(i.amount || 0));
  }
  return { earnings, adjustments, total: round2(earnings + adjustments) };
}
