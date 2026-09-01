/**
 * PORTAL CURRENCY FORMATTING (pure, client-safe).
 *
 * The HCPF claim form's Charge Amount box rejects anything that is not a plain
 * currency string. A JavaScript float carried straight through the payload can
 * arrive as `54.800000000000004` or `49.32000000000001` (2026-09-01 incident:
 * three corrected resubmissions failed at "Charge Amount input"), so EVERY
 * money value the robot types is formatted here first, to an exact two-decimal
 * string with no symbol, no thousands separator and no exponent.
 */

/** Exact two-decimal currency text, or null when the value is not money. */
export function portalMoneyString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const raw = typeof v === "string" ? v.replace(/[$,\s]/g, "") : v;
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Round half away from zero on the cent, immune to binary artifacts.
  const cents = Math.round(Math.abs(n) * 100 + Number.EPSILON * Math.abs(n) * 100);
  const text = (cents / 100).toFixed(2);
  return n < 0 ? `-${text}` : text;
}

/** The same value as a clean number (never a float artifact). */
export function portalMoneyNumber(v: unknown): number | null {
  const s = portalMoneyString(v);
  return s === null ? null : Number(s);
}

/** True when the text is exactly what the portal will accept. */
export function isPortalMoneyString(v: unknown): boolean {
  return typeof v === "string" && /^-?\d+\.\d{2}$/.test(v);
}

/**
 * Format the money keys of one payload object in place-safe fashion.
 * A `<key>_value` numeric twin is added so a worker reading numbers keeps
 * working, while the typed field is always the exact currency text.
 */
export function withPortalMoneyFields<T extends Record<string, any>>(
  obj: T,
  keys: readonly string[],
): T {
  const out: Record<string, any> = { ...obj };
  for (const k of keys) {
    if (!(k in out)) continue;
    const s = portalMoneyString(out[k]);
    if (s === null) continue;
    out[k] = s;
    out[`${k}_value`] = Number(s);
  }
  return out as T;
}

/** Every money-ish key we ever send to the automation service. */
export const PORTAL_MONEY_KEYS = [
  "amount",
  "charge_amount",
  "charged_amount",
  "billed_amount",
  "line_charge",
  "total_charge",
  "rate",
  "unit_rate",
] as const;
