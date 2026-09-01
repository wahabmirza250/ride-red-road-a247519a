/**
 * Pure helpers for the new EDI backend integration.
 *
 * The EDI backend (reached through the secure `redart-edi-bridge` Edge
 * Function) is the single source of truth for claim validation, 837P
 * generation and claim/batch status. Nothing in here duplicates X12 or
 * HCPF rules — it only shapes what the UI displays.
 */

/** Until live HCPF / Edifecs credentials are installed, everything is TEST. */
export const EDI_TEST_LABEL = "EDI TEST";

export type EdiClaimRef = {
  edi_claim_id?: number | string | null;
  edi_batch_id?: number | string | null;
  edi_file_id?: number | string | null;
  edi_status?: string | null;
  edi_validation?: unknown;
  edi_last_sync_at?: string | null;
  edi_last_error?: string | null;
};

/** True only when the record is actually linked to an EDI claim. */
export function hasEdiClaim(rec: EdiClaimRef | null | undefined): boolean {
  const id = rec?.edi_claim_id;
  if (id === null || id === undefined || id === "") return false;
  const n = Number(id);
  return Number.isFinite(n) && n > 0;
}

export function ediClaimId(rec: EdiClaimRef | null | undefined): number | null {
  if (!hasEdiClaim(rec)) return null;
  return Number(rec!.edi_claim_id);
}

/** Colour tone for the compact status pill. */
export function ediStatusTone(status: string | null | undefined): "ok" | "warn" | "error" | "idle" {
  const s = (status ?? "").toLowerCase();
  if (!s) return "idle";
  if (/(accept|valid|paid|success|ok|healthy|complete)/.test(s)) return "ok";
  if (/(reject|denied|error|fail|invalid)/.test(s)) return "error";
  if (/(pending|queued|processing|submitted|warn|hold)/.test(s)) return "warn";
  return "idle";
}

/**
 * Extracts the most useful message from a backend error payload without
 * leaking PHI-heavy blobs into the UI or console.
 */
export function ediErrorMessage(payload: unknown, fallback = "EDI backend unavailable"): string {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload.trim() || fallback;
  if (payload instanceof Error) return payload.message || fallback;
  if (typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const key of ["detail", "error", "message", "non_field_errors"]) {
      const v = p[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (Array.isArray(v) && typeof v[0] === "string") return String(v[0]);
    }
    // DRF-style field errors: { charge_amount: ["..."] }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (Array.isArray(v) && typeof v[0] === "string") parts.push(`${k}: ${v[0]}`);
      else if (typeof v === "string" && v.trim() && v.length < 200) parts.push(`${k}: ${v}`);
      if (parts.length >= 3) break;
    }
    if (parts.length) return parts.join(" · ");
  }
  return fallback;
}

export type EdiValidationIssue = { code?: string; message: string; severity: "error" | "warning" };

/** Normalises whatever validation shape the backend returns into a flat list. */
export function ediValidationIssues(validation: unknown): EdiValidationIssue[] {
  if (!validation || typeof validation !== "object") return [];
  const v = validation as Record<string, unknown>;
  const out: EdiValidationIssue[] = [];
  const push = (raw: unknown, severity: EdiValidationIssue["severity"]) => {
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (typeof item === "string") out.push({ message: item, severity });
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const message =
          typeof o["message"] === "string"
            ? o["message"]
            : typeof o["detail"] === "string"
              ? (o["detail"] as string)
              : JSON.stringify(o).slice(0, 200);
        out.push({
          message,
          severity,
          ...(typeof o["code"] === "string" ? { code: o["code"] as string } : {}),
        });
      }
    }
  };
  push(v["errors"], "error");
  push(v["warnings"], "warning");
  push(v["issues"], "error");
  return out;
}

export function ediIsValid(validation: unknown): boolean | null {
  if (!validation || typeof validation !== "object") return null;
  const v = validation as Record<string, unknown>;
  if (typeof v["is_valid"] === "boolean") return v["is_valid"] as boolean;
  if (typeof v["valid"] === "boolean") return v["valid"] as boolean;
  const issues = ediValidationIssues(validation);
  if (!issues.length) return null;
  return !issues.some((i) => i.severity === "error");
}
