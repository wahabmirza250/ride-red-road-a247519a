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
