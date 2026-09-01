/**
 * Long-distance / documentation state for an EDI claim.
 *
 * RedArt does NOT own the HCPF mileage threshold. The EDI backend holds the
 * database-backed long-distance rules (standard / rural thresholds and the
 * document requirements that follow from them), so this module only READS
 * whatever the backend reported on the claim, its validation result or its
 * status payload. When the backend has not evaluated the claim yet the answer
 * is "pending" — never a guessed mileage cut-off.
 */

export type EdiLongDistanceState = "pending" | "not_required" | "required" | "satisfied";

export type EdiLongDistance = {
  state: EdiLongDistanceState;
  /** Short label for a pill: "Documentation required", "Pending backend evaluation", … */
  label: string;
  /** Backend's own rule name / threshold description, when it sends one. */
  rule: string | null;
  /** Document types the backend says are still missing. */
  missingDocuments: string[];
  /** Document types the backend says are required (missing or not). */
  requiredDocuments: string[];
  /** True only when the backend explicitly flagged the claim as long distance. */
  isLongDistance: boolean | null;
};

const PENDING: EdiLongDistance = {
  state: "pending",
  label: "Pending backend evaluation",
  rule: null,
  missingDocuments: [],
  requiredDocuments: [],
  isLongDistance: null,
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Collects the record plus any nested objects the backend nests results under. */
function scopes(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];
  const out = [root];
  for (const key of [
    "long_distance",
    "long_distance_check",
    "documentation",
    "document_status",
    "documents",
    "attachments",
    "attachment_status",
    "claim",
    "data",
    "result",
    "validation",
  ]) {
    const nested = asRecord(root[key]);
    if (nested) out.push(nested);
  }
  return out;
}

function firstBoolean(list: Record<string, unknown>[], keys: string[]): boolean | null {
  for (const scope of list) {
    for (const key of keys) {
      const v = scope[key];
      if (typeof v === "boolean") return v;
      if (v === "true") return true;
      if (v === "false") return false;
    }
  }
  return null;
}

function firstString(list: Record<string, unknown>[], keys: string[]): string | null {
  for (const scope of list) {
    for (const key of keys) {
      const v = scope[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

function stringList(list: Record<string, unknown>[], keys: string[]): string[] {
  const out: string[] = [];
  for (const scope of list) {
    for (const key of keys) {
      const v = scope[key];
      if (!Array.isArray(v)) continue;
      for (const item of v) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
        else {
          const o = asRecord(item);
          const name =
            (typeof o?.["name"] === "string" && o["name"]) ||
            (typeof o?.["type"] === "string" && o["type"]) ||
            (typeof o?.["document_type"] === "string" && o["document_type"]) ||
            (typeof o?.["label"] === "string" && o["label"]);
          if (typeof name === "string" && name.trim()) out.push(name.trim());
        }
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Reads the backend's long-distance / attachment answer out of one or more
 * backend payloads (claim, validation result, status). The first payload that
 * actually contains an answer wins; otherwise the state is "pending".
 */
export function readEdiLongDistance(...payloads: unknown[]): EdiLongDistance {
  const list = payloads.flatMap((p) => scopes(p));
  if (!list.length) return PENDING;

  const isLongDistance = firstBoolean(list, [
    "is_long_distance",
    "long_distance",
    "longdistance",
    "long_distance_trip",
  ]);
  const required = firstBoolean(list, [
    "attachment_required",
    "attachments_required",
    "documentation_required",
    "document_required",
    "requires_documentation",
    "requires_attachment",
  ]);
  const satisfied = firstBoolean(list, [
    "attachment_received",
    "attachments_complete",
    "documentation_complete",
    "documents_complete",
    "attachment_on_file",
  ]);
  const rule = firstString(list, [
    "long_distance_rule",
    "rule",
    "rule_label",
    "threshold_label",
    "threshold_description",
    "long_distance_threshold",
    "threshold_miles",
  ]);
  const missingDocuments = stringList(list, [
    "missing_documents",
    "missing_document_types",
    "missing_attachments",
    "documents_missing",
  ]);
  const requiredDocuments = stringList(list, [
    "required_documents",
    "required_document_types",
    "required_attachments",
    "document_requirements",
  ]);

  const nothingKnown =
    isLongDistance === null &&
    required === null &&
    satisfied === null &&
    !missingDocuments.length &&
    !requiredDocuments.length;
  if (nothingKnown) return { ...PENDING, rule: rule ?? null };

  const ruleLabel = rule ? formatRule(rule) : null;

  if (required === false && !missingDocuments.length) {
    return {
      state: "not_required",
      label: "No documentation required",
      rule: ruleLabel,
      missingDocuments: [],
      requiredDocuments,
      isLongDistance,
    };
  }

  const stillMissing = missingDocuments.length > 0;
  if (satisfied === true && !stillMissing) {
    return {
      state: "satisfied",
      label: "Documentation on file",
      rule: ruleLabel,
      missingDocuments: [],
      requiredDocuments,
      isLongDistance,
    };
  }

  if (required === true || stillMissing) {
    return {
      state: "required",
      label: stillMissing ? "Documentation missing" : "Documentation required",
      rule: ruleLabel,
      missingDocuments,
      requiredDocuments,
      isLongDistance,
    };
  }

  // The backend told us whether it is long distance but nothing about documents.
  return {
    state: "pending",
    label: isLongDistance ? "Long distance — awaiting document rules" : "Pending backend evaluation",
    rule: ruleLabel,
    missingDocuments,
    requiredDocuments,
    isLongDistance,
  };
}

function formatRule(rule: string): string {
  return /^\d+(\.\d+)?$/.test(rule) ? `${rule} mi threshold (backend rule)` : rule;
}
