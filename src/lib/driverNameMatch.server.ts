/* ------------------------------------------------------------------
 * Fuzzy driver-name resolution for paper bills.
 *
 * OCR reads a handwritten driver name off a paper trip report, so the text
 * inherits misspellings, stray capitals and reversed "Last, First" order.
 * Storing that raw string breaks the Driver Pay system, which links paper
 * claims to a driver by exact normalized name.
 *
 * This module matches the OCR text against the company's real driver
 * profiles and returns the canonical profile spelling when confident.
 * Below the threshold we return no match and the caller keeps the raw text,
 * so nothing ever breaks — worst case we behave exactly as before.
 * ------------------------------------------------------------------ */

export type DriverNameMatch = {
  /** Canonical "First Last" from the driver's profile, or null when unmatched. */
  canonical_name: string | null;
  /** `drivers.id` of the matched driver, or null. */
  driver_id: string | null;
  /** `drivers.user_id` (auth user) of the matched driver, or null. */
  user_id: string | null;
  /** 0–1 similarity of the best candidate (whether or not it passed). */
  score: number;
  /** The text the caller should persist: canonical name when matched, else raw. */
  resolved_name: string | null;
};

/** Confidence needed before we overwrite what the paper actually says. */
export const DRIVER_NAME_MATCH_THRESHOLD = 0.74;
/** The winner must be this much clearer than the runner-up to be trusted. */
export const DRIVER_NAME_MATCH_MARGIN = 0.08;

export function normalizeName(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Similarity that tolerates handwriting-level noise:
 *  - whole-string edit distance
 *  - token-set comparison, so "Last, First" and "First Last" score the same
 *  - initials ("J Smith" vs "John Smith") count as a token hit
 */
export function nameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const whole = ratio(a, b);

  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  const sortedRatio = ratio([...at].sort().join(" "), [...bt].sort().join(" "));

  // Best pairing of each token from the shorter list into the longer one.
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  const pool = [...long];
  let hits = 0;
  for (const t of short) {
    let bestIdx = -1;
    let best = 0;
    pool.forEach((p, i) => {
      let sc = ratio(t, p);
      // A single letter matching the first letter of a full token = initial.
      if ((t.length === 1 || p.length === 1) && t[0] === p[0]) sc = Math.max(sc, 0.9);
      if (sc > best) {
        best = sc;
        bestIdx = i;
      }
    });
    if (best >= 0.7 && bestIdx >= 0) {
      hits += best;
      pool.splice(bestIdx, 1);
    }
  }
  const tokenScore = short.length ? hits / short.length : 0;
  // Penalise a one-token OCR read matching a two-token profile only lightly.
  const coverage = short.length / long.length;
  const tokenSet = tokenScore * (0.75 + 0.25 * coverage);

  return Math.max(whole, sortedRatio, tokenSet);
}

type Sb = {
  from: (t: string) => any;
};

/**
 * Match an OCR'd driver name to a real driver profile in the same company.
 * Returns the canonical spelling only when the best candidate clears the
 * confidence threshold; otherwise the raw text passes straight through.
 */
export async function resolveDriverName(
  supabase: Sb,
  companyId: string | null,
  rawName: string | null | undefined,
): Promise<DriverNameMatch> {
  const raw = String(rawName ?? "").trim();
  const miss: DriverNameMatch = {
    canonical_name: null,
    driver_id: null,
    user_id: null,
    score: 0,
    resolved_name: raw || null,
  };
  if (!raw || normalizeName(raw).length < 3) return miss;

  let q = supabase.from("drivers").select("id, user_id, company_id");
  if (companyId) q = q.eq("company_id", companyId);
  const { data: drivers } = await q.limit(500);
  const rows = (drivers ?? []) as { id: string; user_id: string | null }[];
  const userIds = rows.map((d) => d.user_id).filter(Boolean) as string[];
  if (!userIds.length) return miss;

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", userIds);

  let best: DriverNameMatch = miss;
  let runnerUp = 0;
  for (const d of rows) {
    const p = (profs ?? []).find((x: any) => x.id === d.user_id);
    if (!p) continue;
    const full = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (!full) continue;
    const score = nameSimilarity(raw, full);
    if (score > best.score) {
      runnerUp = best.score;
      best = {
        canonical_name: full,
        driver_id: d.id,
        user_id: d.user_id,
        score,
        resolved_name: full,
      };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // Ambiguous (two drivers with near-identical names) => keep the raw text.
  if (best.score < DRIVER_NAME_MATCH_THRESHOLD || best.score - runnerUp < DRIVER_NAME_MATCH_MARGIN) {
    return { ...miss, score: best.score };
  }
  return best;
}
