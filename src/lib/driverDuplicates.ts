/**
 * DUPLICATE DRIVER DETECTION (pure).
 *
 * Two driver rows are only ever *candidates*. A merge is a human decision:
 * this module never decides that two people are the same, it only ranks the
 * evidence so an admin can review it.
 *
 * Strong identifiers (any one is enough to propose a merge):
 *   - the same auth account (`user_id`)
 *   - the same email address
 *   - the same 10-digit phone number
 * A matching normalized name is SUPPORTING evidence only and can never, on its
 * own, produce an auto-mergeable candidate.
 */

export type DriverIdentity = {
  id: string;
  user_id: string | null;
  company_id: string | null;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string | null;
  /** Row counts used to pick a sensible canonical row. */
  activity?: number;
};

export type MatchStrength = "strong" | "supporting";

export type DuplicateGroup = {
  key: string;
  reason: "same_account" | "same_email" | "same_phone" | "same_name";
  strength: MatchStrength;
  drivers: DriverIdentity[];
  /** Suggested keeper — most activity, then oldest row. Advisory only. */
  suggestedKeeperId: string;
  /** True only when a strong identifier matches and names do not conflict. */
  reviewReady: boolean;
  notes: string[];
};

export const normalizeName = (first?: string | null, last?: string | null) =>
  `${first ?? ""} ${last ?? ""}`.toLowerCase().replace(/[^a-z]+/g, " ").trim();

export const normalizeEmail = (e?: string | null) => (e ?? "").trim().toLowerCase();

export const normalizePhone = (p?: string | null) => {
  const digits = (p ?? "").replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};

const activityOf = (d: DriverIdentity) => Number(d.activity ?? 0);

function pickKeeper(drivers: DriverIdentity[]): string {
  const sorted = [...drivers].sort((a, b) => {
    const diff = activityOf(b) - activityOf(a);
    if (diff !== 0) return diff;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
  return sorted[0]!.id;
}

/** Group driver rows by every identifier that repeats. */
export function findDuplicateDriverGroups(drivers: DriverIdentity[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  const bucket = (
    keyOf: (d: DriverIdentity) => string,
    reason: DuplicateGroup["reason"],
    strength: MatchStrength,
  ) => {
    const map = new Map<string, DriverIdentity[]>();
    for (const d of drivers) {
      const k = keyOf(d);
      if (!k) continue;
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    for (const [k, list] of map) {
      if (list.length < 2) continue;
      const names = new Set(list.map((d) => normalizeName(d.first_name, d.last_name)).filter(Boolean));
      const emails = new Set(list.map((d) => normalizeEmail(d.email)).filter(Boolean));
      const notes: string[] = [];
      if (names.size > 1) notes.push(`Different names on file: ${[...names].join(" / ")}`);
      if (reason === "same_phone" && emails.size > 1) {
        notes.push(`Different email addresses: ${[...emails].join(" / ")}`);
      }
      if (new Set(list.map((d) => d.company_id)).size > 1) {
        notes.push("Rows belong to different companies — never merge across companies.");
      }
      groups.push({
        key: `${reason}:${k}`,
        reason,
        strength,
        drivers: list,
        suggestedKeeperId: pickKeeper(list),
        reviewReady: strength === "strong" && names.size <= 1 && new Set(list.map((d) => d.company_id)).size === 1,
        notes,
      });
    }
  };

  bucket((d) => d.user_id ?? "", "same_account", "strong");
  bucket((d) => normalizeEmail(d.email), "same_email", "strong");
  bucket((d) => normalizePhone(d.phone), "same_phone", "strong");
  bucket((d) => normalizeName(d.first_name, d.last_name), "same_name", "supporting");

  // De-duplicate identical member sets, keeping the strongest reason.
  const seen = new Map<string, DuplicateGroup>();
  const rank = (g: DuplicateGroup) => (g.strength === "strong" ? 1 : 0);
  for (const g of groups) {
    const sig = [...g.drivers.map((d) => d.id)].sort().join("|");
    const prev = seen.get(sig);
    if (!prev || rank(g) > rank(prev)) seen.set(sig, g);
  }
  return [...seen.values()];
}

/** Whether an admin may submit this pair for merging at all. */
export function canMergePair(
  a: DriverIdentity,
  b: DriverIdentity,
): { ok: true } | { ok: false; reason: string } {
  if (a.id === b.id) return { ok: false, reason: "Pick two different driver records." };
  if (a.company_id !== b.company_id)
    return { ok: false, reason: "These records belong to different companies." };
  const strong =
    (a.user_id && a.user_id === b.user_id) ||
    (normalizeEmail(a.email) && normalizeEmail(a.email) === normalizeEmail(b.email)) ||
    (normalizePhone(a.phone) && normalizePhone(a.phone) === normalizePhone(b.phone)) ||
    (normalizeName(a.first_name, a.last_name) &&
      normalizeName(a.first_name, a.last_name) === normalizeName(b.first_name, b.last_name));
  if (!strong)
    return {
      ok: false,
      reason: "No shared account, email, phone or name — these are not the same person.",
    };
  return { ok: true };
}
