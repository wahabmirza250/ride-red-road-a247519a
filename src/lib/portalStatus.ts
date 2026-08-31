/**
 * Portal status wording -> our canonical claim status (pure, client-safe).
 * Unknown wording returns null; we never guess a financial outcome.
 */
export function normalizePortalStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/\bpaid\b|payment issued|finalized payment/.test(s)) return "paid";
  if (/\bdenied\b|finalized denial/.test(s)) return "denied";
  if (/\breject/.test(s)) return "rejected";
  if (/suspend|\bpend(ed|ing)?\b|in process|in review/.test(s)) return "suspended";
  if (/\bapproved\b|accepted/.test(s)) return "approved";
  if (/\bsubmitted\b|received/.test(s)) return "submitted";
  return null;
}
