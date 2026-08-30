/**
 * COMPANY ID DISCIPLINE for every portal-automation call.
 *
 * PRODUCTION INCIDENT: the automation service answered
 * "Portal credential lookup failed (400): company_id must be a UUID" because
 * something other than `billing_records.company_id` reached it. A portal
 * account key (`acct:...`, `nhcpf-colorado:someone`), a portal id
 * (`hcpf-colorado`) or a submit account key is NEVER a company id — those
 * identify a portal login, not a tenant.
 *
 * Every outbound request must carry the tenant UUID, and anything else is a
 * configuration error we refuse locally instead of spending a portal session
 * on.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/** Returns the lower-cased tenant UUID, or null when the value is not one. */
export function normalizeCompanyId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^["']|["']$/g, "");
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

/** True for values that are clearly a portal account/login key, not a tenant. */
export function looksLikeAccountKey(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!s) return false;
  return !UUID_RE.test(s) && (s.startsWith("acct:") || s.includes(":") || /[a-z]/.test(s));
}

export const COMPANY_ID_CONFIG_ERROR =
  "Configuration problem: the portal lookup was given a portal account key instead of the company id. Nothing was sent to the portal.";

/** Guard used right before any outbound automation call. */
export function requirePortalCompanyId(v: unknown): string {
  const id = normalizeCompanyId(v);
  if (!id) throw new Error(COMPANY_ID_CONFIG_ERROR);
  return id;
}
