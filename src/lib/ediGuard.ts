/**
 * EDI guard rails — pure, shared by client and server.
 *
 * Two jobs:
 *
 *   1. Decide which EDI paths a *browser-driven* call may reach at all. Only
 *      tenant-neutral, read-only endpoints qualify (`/api/health/` and the
 *      integration catalog). Everything that names a resource id — a claim, a
 *      submission batch, an 837P file — must go through a vetted server
 *      function that proves the resource belongs to the caller's company, so
 *      nobody can enumerate another company's claims by guessing ids.
 *
 *   2. Small pure helpers the vetted server layer shares: id extraction from
 *      whatever shape the backend answers with, batch-number generation and
 *      the documented batch-create body.
 *
 * Nothing here talks to the network and nothing here contains PHI.
 */
import { EDI_PATHS } from "@/lib/ediTransport";

/* ------------------------------------------------------------------ */
/* 1. Browser-reachable path allow-list                                */
/* ------------------------------------------------------------------ */

/**
 * The ONLY paths the generic authenticated proxy may forward. Both are
 * tenant-neutral: they describe the backend itself, never a company's data.
 */
export const SAFE_EDI_READS: readonly string[] = [
  EDI_PATHS.health(),
  EDI_PATHS.integrationCatalog(),
];

/** Strips query/hash, collapses `//` and guarantees exactly one leading slash. */
export function normalizeEdiPath(path: string | null | undefined): string {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0] ?? "";
  return `/${noQuery.replace(/^\/+/, "").replace(/\/{2,}/g, "/")}`;
}

/** Path shape check: an EDI API path, never an absolute URL or a traversal. */
export function isEdiApiPath(path: string | null | undefined): boolean {
  const p = String(path ?? "");
  if (!p.startsWith("/api/")) return false;
  if (p.includes("://") || p.includes("..") || p.includes("\\")) return false;
  return true;
}

/**
 * True only for the tenant-neutral read-only endpoints, called with GET.
 * Everything else must use a vetted, ownership-checked server function.
 */
export function isSafeEdiReadPath(
  path: string | null | undefined,
  method: string = "GET",
): boolean {
  if ((method ?? "GET").toUpperCase() !== "GET") return false;
  const p = normalizeEdiPath(path);
  if (!isEdiApiPath(p)) return false;
  const withSlash = p.endsWith("/") ? p : `${p}/`;
  return SAFE_EDI_READS.includes(withSlash);
}

/** Message shown when a caller asks for a path the proxy will not forward. */
export const EDI_PATH_BLOCKED =
  "Blocked: this EDI endpoint can only be reached through an authorised, company-scoped action.";

/* ------------------------------------------------------------------ */
/* 2. Ownership vocabulary                                             */
/* ------------------------------------------------------------------ */

export type EdiResourceKind = "claim" | "batch" | "file";

const RESOURCE_LABEL: Record<EdiResourceKind, string> = {
  claim: "EDI claim",
  batch: "submission batch",
  file: "837P file",
};

/**
 * Deliberately identical wording for "does not exist" and "belongs to another
 * company": a tenant must not be able to tell the two apart.
 */
export function ediOwnershipMessage(kind: EdiResourceKind, id: number | string): string {
  return `${RESOURCE_LABEL[kind]} #${id} was not found for this company.`;
}

export function ediUnlinkedMessage(): string {
  return "This bill is not linked to an EDI claim yet — validate it first.";
}

/* ------------------------------------------------------------------ */
/* 3. Backend id parsing                                               */
/* ------------------------------------------------------------------ */

/** Positive integer id, or null. Rejects floats, negatives and junk. */
export function parseEdiId(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** Pulls an entity id out of whatever shape the backend returned. */
export function entityIdFrom(payload: unknown, keys: string[] = []): number | null {
  const direct = parseEdiId(payload);
  if (direct !== null) return direct;
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  for (const key of ["id", ...keys]) {
    const found = parseEdiId(rec[key]);
    if (found !== null) return found;
  }
  for (const nested of ["data", "claim", "batch", "file", "result", "results"]) {
    const child = rec[nested];
    if (Array.isArray(child)) {
      const first = child[0];
      const found = entityIdFrom(first, keys);
      if (found !== null) return found;
    } else if (child && typeof child === "object") {
      const found = entityIdFrom(child, keys);
      if (found !== null) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 4. Submission batch contract                                        */
/* ------------------------------------------------------------------ */

export type EdiBatchCreateInput = {
  batchNumber: string;
  tradingPartner: string | number | null;
  environment: "test" | "production";
};

/**
 * The documented create payload: `batch_number`, `trading_partner`,
 * `environment`. Claims are attached afterwards with `add-claim/` — a
 * `claim_ids` array is NOT part of the documented create contract and is
 * never sent.
 */
export function buildBatchCreateBody(input: EdiBatchCreateInput): Record<string, unknown> {
  return {
    batch_number: input.batchNumber,
    trading_partner: input.tradingPartner,
    environment: input.environment,
  };
}

/** Everything that must be known before a batch can even be requested. */
export function batchCreateBlockers(input: Partial<EdiBatchCreateInput>): string[] {
  const out: string[] = [];
  if (!String(input.batchNumber ?? "").trim()) out.push("Batch number could not be generated");
  if (input.tradingPartner === null || input.tradingPartner === undefined || input.tradingPartner === "")
    out.push(
      "No trading partner is linked for this company yet — run “Sync to EDI backend” in Provider Setup.",
    );
  if (input.environment !== "test" && input.environment !== "production")
    out.push("Environment must be TEST or PRODUCTION");
  return out;
}

const BATCH_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Company-unique, human-readable batch number: `RA-<company>-<stamp>-<salt>`.
 * Stable length, safe characters only, and never reused because the stamp goes
 * to the second and the salt breaks same-second ties.
 */
export function generateBatchNumber(
  companyId: string,
  when: Date = new Date(),
  salt?: string,
): string {
  const company = companyId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase() || "company";
  const iso = when.toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, "")}${iso.slice(11, 19).replace(/:/g, "")}`;
  const tail =
    salt ??
    Array.from({ length: 3 }, () => BATCH_ALPHABET[Math.floor(Math.random() * BATCH_ALPHABET.length)]).join(
      "",
    );
  return `RA-${company}-${stamp}-${tail}`;
}
