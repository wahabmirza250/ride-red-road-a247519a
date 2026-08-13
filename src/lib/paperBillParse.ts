/**
 * Pure helpers for cleaning up values the vision model reads off a paper trip
 * report. Kept out of *.functions.ts so server-function splitting stays safe.
 */

/**
 * Paper forms sometimes write a value inside parentheses/brackets — "(8)" —
 * and sometimes plain — "8". When brackets are present the value is ONLY the
 * digits inside them; anything outside (a label, a stray digit, units) must be
 * dropped rather than concatenated, so "(8) 12mi" reads as 8, never 812.
 */
export function digitsFromBracketAware(raw: string): string {
  const bracketed = raw.match(/[([{]\s*([0-9][0-9.,\s]*)\s*[)\]}]/);
  const source = bracketed ? bracketed[1] : raw;
  return source.replace(/[^0-9]/g, "");
}

/**
 * Normalize a handwritten clock time to 24h "HH:MM".
 * Returns null for anything unreadable — a paper bill must NEVER fall back to
 * an invented time.
 */
export function normalizeClockTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim().toLowerCase().replace(/\./g, "");
  const m = t.match(/^(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (!Number.isFinite(h) || min > 59) return null;
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Build a timestamptz for a trip date + clock time as written on the paper
 * form (Colorado / Mountain Time). When no time was readable, anchor at local
 * midnight so nothing pretends to know the hour.
 */
export function mountainIso(dateYmd: string, hhmm: string | null): string {
  const date = dateYmd.slice(0, 10);
  const time = hhmm ?? "00:00";
  // Mountain Time is UTC-6 (MDT) or UTC-7 (MST); resolve the real offset for
  // this date instead of hardcoding one.
  const probe = new Date(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    timeZoneName: "shortOffset",
  });
  const name = fmt.formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const off = name.match(/GMT([+-]\d{1,2})/);
  const hours = off ? Number(off[1]) : -6;
  const sign = hours < 0 ? "-" : "+";
  const abs = String(Math.abs(hours)).padStart(2, "0");
  return new Date(`${date}T${time}:00${sign}${abs}:00`).toISOString();
}
