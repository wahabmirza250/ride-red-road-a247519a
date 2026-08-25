/**
 * Service-line modifiers for RESUBMISSION drafts only.
 *
 * Modifier 76 ("Repeat Procedure by Same MD") is offered as a manual choice.
 * Nothing in this module — or anywhere else in the app — applies it
 * automatically. Every add/remove produces an audit entry.
 */

export const MODIFIER_OPTIONS = [
  { code: "76", label: "Repeat Procedure by Same MD" },
  { code: "77", label: "Repeat Procedure by Another MD" },
  { code: "TK", label: "Extra patient or passenger" },
  { code: "TN", label: "Rural / outside providers' customary area" },
  { code: "GM", label: "Multiple patients on one trip" },
] as const;

export type ModifierCode = (typeof MODIFIER_OPTIONS)[number]["code"];

/** HCPF's claim form exposes four modifier slots per service line. */
export const MAX_MODIFIERS_PER_LINE = 4;

export const modifierLabel = (code: string) =>
  MODIFIER_OPTIONS.find((m) => m.code === code)?.label ?? code;

export type ModifierAuditEntry = {
  action: "added" | "removed";
  modifier: string;
  reason: string | null;
};

export type ModifierChange = {
  modifiers: string[];
  audit: ModifierAuditEntry[];
};

const clean = (list: string[]) =>
  [...new Set(list.map((m) => m.trim().toUpperCase()).filter(Boolean))];

export function addModifier(
  current: string[],
  code: string,
  reason?: string | null,
): ModifierChange {
  const next = clean(current);
  const c = code.trim().toUpperCase();
  if (!c) return { modifiers: next, audit: [] };
  if (next.includes(c)) return { modifiers: next, audit: [] };
  if (next.length >= MAX_MODIFIERS_PER_LINE)
    throw new Error(`A service line supports at most ${MAX_MODIFIERS_PER_LINE} modifiers.`);
  return {
    modifiers: [...next, c],
    audit: [{ action: "added", modifier: c, reason: reason ?? null }],
  };
}

export function removeModifier(
  current: string[],
  code: string,
  reason?: string | null,
): ModifierChange {
  const c = code.trim().toUpperCase();
  const next = clean(current);
  if (!next.includes(c)) return { modifiers: next, audit: [] };
  return {
    modifiers: next.filter((m) => m !== c),
    audit: [{ action: "removed", modifier: c, reason: reason ?? null }],
  };
}

/** Diff two modifier lists into audit entries (used when a whole line is saved). */
export function diffModifiers(
  before: string[],
  after: string[],
  reason?: string | null,
): ModifierAuditEntry[] {
  const b = clean(before);
  const a = clean(after);
  return [
    ...a.filter((m) => !b.includes(m)).map((m) => ({ action: "added" as const, modifier: m, reason: reason ?? null })),
    ...b.filter((m) => !a.includes(m)).map((m) => ({ action: "removed" as const, modifier: m, reason: reason ?? null })),
  ];
}

/** Resubmission drafts are the ONLY place modifiers may be edited. */
export function assertEditableResubmission(status: string | null | undefined) {
  if (status !== "draft")
    throw new Error("Modifiers can only be changed while the resubmission is still a draft.");
}
