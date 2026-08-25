/**
 * Pure driver-compliance logic: insurance expiry states and vehicle-expense
 * aggregation. No I/O, so it is safe on both client and server.
 */

export const ALERT_THRESHOLDS = [30, 14, 7] as const;

export type InsuranceState = "valid" | "expiring_soon" | "expired" | "unknown";

export const INSURANCE_STATE_LABEL: Record<InsuranceState, string> = {
  valid: "Valid",
  expiring_soon: "Expiring Soon",
  expired: "Expired",
  unknown: "No document",
};

export const daysUntil = (date: string | null | undefined, now: Date = new Date()): number | null => {
  if (!date) return null;
  const end = new Date(`${String(date).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(end)) return null;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / 86_400_000);
};

export function insuranceState(
  expiration: string | null | undefined,
  now: Date = new Date(),
): InsuranceState {
  const d = daysUntil(expiration, now);
  if (d === null) return "unknown";
  if (d < 0) return "expired";
  if (d <= ALERT_THRESHOLDS[0]) return "expiring_soon";
  return "valid";
}

/** The strictest threshold crossed, used for dashboard alerts (30/14/7). */
export function alertThreshold(
  expiration: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const d = daysUntil(expiration, now);
  if (d === null || d < 0) return null;
  for (const t of [...ALERT_THRESHOLDS].sort((a, b) => a - b)) if (d <= t) return t;
  return null;
}

export const EXPENSE_CATEGORIES = [
  { value: "oil_change", label: "Oil Change" },
  { value: "tires", label: "Tires" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "maintenance", label: "Maintenance" },
  { value: "car_wash", label: "Car Wash" },
  { value: "fuel", label: "Fuel" },
  { value: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export const expenseCategoryLabel = (v: string) =>
  EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? "Other";

export type ExpenseRow = {
  category: string;
  amount: number;
  vehicle_label?: string | null;
  driver_id?: string | null;
  expense_date?: string | null;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function totalsBy(rows: ExpenseRow[], key: "category" | "vehicle_label" | "driver_id") {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[key] ?? "unknown");
    m.set(k, r2((m.get(k) ?? 0) + Number(r.amount || 0)));
  }
  return [...m.entries()]
    .map(([k, total]) => ({ key: k, total }))
    .sort((a, b) => b.total - a.total);
}

export const expenseTotal = (rows: ExpenseRow[]) =>
  r2(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
