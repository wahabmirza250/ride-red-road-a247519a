/**
 * Reads acknowledgement / claim-status / remittance information out of the
 * EDI backend's own status payload.
 *
 * The backend decides what it exposes: 999 acknowledgements, 277 claim status
 * and 835 remittance are shown only when they are actually present in the
 * payload it returned. Nothing is invented, and an absent section is reported
 * honestly as "Not available from backend yet".
 */

export type EdiFeedSection = {
  key: "ack_999" | "status_277" | "remit_835";
  title: string;
  available: boolean;
  /** One-line summary: backend status/decision text. */
  summary: string;
  /** Precise reasons/codes the backend supplied. */
  reasons: string[];
  /** Payment fields for 835, when present. */
  amounts: { label: string; value: string }[];
};

export const NOT_AVAILABLE = "Not available from backend yet";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pick(payload: unknown, keys: string[]): unknown {
  const root = asRecord(payload);
  if (!root) return null;
  for (const key of keys) {
    if (root[key] !== undefined && root[key] !== null) return root[key];
  }
  for (const nestedKey of ["data", "result", "claim", "status", "acknowledgements"]) {
    const nested = asRecord(root[nestedKey]);
    if (!nested) continue;
    for (const key of keys) {
      if (nested[key] !== undefined && nested[key] !== null) return nested[key];
    }
  }
  return null;
}

function textOf(value: unknown, keys: string[]): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const rec = asRecord(value);
  if (!rec) return null;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "Accepted" : "Rejected";
  }
  return null;
}

function reasonsOf(value: unknown): string[] {
  const rec = asRecord(value);
  if (!rec) return [];
  const out: string[] = [];
  for (const key of [
    "errors",
    "reasons",
    "rejection_reasons",
    "reject_reasons",
    "messages",
    "status_messages",
    "adjustments",
    "remarks",
  ]) {
    const list = rec[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
      else {
        const o = asRecord(item);
        if (!o) continue;
        const code = typeof o["code"] === "string" ? o["code"] : null;
        const message =
          (typeof o["message"] === "string" && o["message"]) ||
          (typeof o["description"] === "string" && o["description"]) ||
          (typeof o["reason"] === "string" && o["reason"]) ||
          null;
        if (message) out.push(code ? `${code} — ${message}` : message);
        else if (code) out.push(code);
      }
    }
  }
  return [...new Set(out)];
}

function amountsOf(value: unknown): { label: string; value: string }[] {
  const rec = asRecord(value);
  if (!rec) return [];
  const map: [string, string][] = [
    ["billed_amount", "Billed"],
    ["charge_amount", "Billed"],
    ["allowed_amount", "Allowed"],
    ["paid_amount", "Paid"],
    ["payment_amount", "Paid"],
    ["patient_responsibility", "Patient responsibility"],
    ["adjustment_amount", "Adjustment"],
    ["check_number", "Check / EFT"],
    ["payment_date", "Payment date"],
  ];
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of map) {
    const v = rec[key];
    if (v === undefined || v === null || v === "") continue;
    out.push({ label, value: typeof v === "number" ? v.toFixed(2) : String(v) });
  }
  return out;
}

function section(
  key: EdiFeedSection["key"],
  title: string,
  value: unknown,
  summaryKeys: string[],
): EdiFeedSection {
  if (value === null || value === undefined) {
    return { key, title, available: false, summary: NOT_AVAILABLE, reasons: [], amounts: [] };
  }
  return {
    key,
    title,
    available: true,
    summary: textOf(value, summaryKeys) ?? "Received",
    reasons: reasonsOf(value),
    amounts: key === "remit_835" ? amountsOf(value) : [],
  };
}

/** Turns a stored claim-status payload into the three display sections. */
export function ediFeedSections(statusPayload: unknown): EdiFeedSection[] {
  return [
    section(
      "ack_999",
      "999 acknowledgement",
      pick(statusPayload, ["ack_999", "999", "acknowledgement_999", "functional_ack"]),
      ["status", "ack_status", "result", "accepted"],
    ),
    section(
      "status_277",
      "277 claim status",
      pick(statusPayload, ["status_277", "277", "claim_status_277", "claim_status"]),
      ["status", "status_code", "category", "description"],
    ),
    section(
      "remit_835",
      "835 remittance",
      pick(statusPayload, ["remit_835", "835", "remittance", "payment", "era"]),
      ["status", "payment_status", "decision"],
    ),
  ];
}

/** Backend's own claim status string, used for the row pill. */
export function ediBackendStatus(statusPayload: unknown): string | null {
  const root = asRecord(statusPayload);
  if (!root) return null;
  for (const key of ["status", "claim_status", "state"]) {
    const v = root[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const nested = asRecord(root["data"]);
  if (nested && typeof nested["status"] === "string") return String(nested["status"]);
  return null;
}
