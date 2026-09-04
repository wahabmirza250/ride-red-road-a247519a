/**
 * PORTAL CLAIM NUMBER RULES (pure — safe on the client).
 *
 * HCPF hands back a 13-digit claim / confirmation number. Everything else that
 * ends up in a confirmation column (a job id, a truncated read, a message
 * fragment, an operator note) is NOT a claim number and must never be attached
 * to a bill or presented as portal evidence.
 *
 * Nothing here talks to the portal, the database or the automation service.
 */

/** HCPF claim ids are exactly 13 digits. */
export const PORTAL_CLAIM_NUMBER_RE = /^\d{13}$/;

/** Strip the punctuation a human or an OCR pass may have introduced. */
export function normalizeClaimNumber(value: unknown): string {
  return String(value ?? "").replace(/[\s\u00a0.\-_/]/g, "").trim();
}

/** True only for a real 13-digit HCPF claim number. */
export function isPortalClaimNumber(value: unknown): boolean {
  return PORTAL_CLAIM_NUMBER_RE.test(normalizeClaimNumber(value));
}

/** Two confirmation values that mean the same claim. */
export function sameClaimNumber(a: unknown, b: unknown): boolean {
  const x = normalizeClaimNumber(a);
  const y = normalizeClaimNumber(b);
  return x !== "" && x === y;
}

export type ConfirmationSource =
  | "portal_confirmation"
  | "submitted_confirmation"
  | "robot_confirmation_number"
  | "state_confirmation_number";

/** Confirmation columns in the order we trust them. */
export const CONFIRMATION_SOURCES: ConfirmationSource[] = [
  "portal_confirmation",
  "submitted_confirmation",
  "robot_confirmation_number",
  "state_confirmation_number",
];

export type ConfirmationPick =
  | { ok: true; claimNumber: string; sources: ConfirmationSource[] }
  | { ok: false; reason: string; conflicting?: string[] };

/**
 * Read ONE claim number out of a trip / bill.
 *
 * Every 13-digit value present must agree. Two different claim numbers on the
 * same trip is exactly the situation a human has to look at, so it is refused
 * rather than guessed.
 */
export function pickConfirmationNumber(
  row: Partial<Record<ConfirmationSource, unknown>> | null | undefined,
): ConfirmationPick {
  if (!row) return { ok: false, reason: "No trip row to read a confirmation number from." };
  const found = new Map<string, ConfirmationSource[]>();
  const junk: string[] = [];
  for (const key of CONFIRMATION_SOURCES) {
    const raw = (row as Record<string, unknown>)[key];
    const value = normalizeClaimNumber(raw);
    if (!value) continue;
    if (!PORTAL_CLAIM_NUMBER_RE.test(value)) {
      junk.push(`${key}="${String(raw).slice(0, 40)}"`);
      continue;
    }
    found.set(value, [...(found.get(value) ?? []), key]);
  }
  if (found.size === 0)
    return {
      ok: false,
      reason: junk.length
        ? `No 13-digit HCPF claim number is stored on this trip (${junk.join(", ")}).`
        : "No HCPF claim number is stored on this trip.",
    };
  if (found.size > 1)
    return {
      ok: false,
      reason: `This trip carries ${found.size} different claim numbers (${[...found.keys()].join(
        ", ",
      )}), so a person must decide which one belongs to this bill.`,
      conflicting: [...found.keys()],
    };
  const [claimNumber, sources] = [...found.entries()][0]!;
  return { ok: true, claimNumber, sources };
}
