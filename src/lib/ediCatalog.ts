/**
 * Reads the EDI backend's own endpoint catalog (`/api/v1/integration/lovable/`)
 * and answers two questions, purely:
 *
 *   1. Which path does THIS backend expose for provider profiles, trading
 *      partners, patients and NEMT trips? RedArt never guesses those paths —
 *      an entity it cannot find in the catalog is reported as "the backend
 *      does not advertise it", never invented.
 *
 *   2. Does the backend still advertise the documented endpoints this app
 *      depends on (claims, validate, batches, add-claim, generate-837p,
 *      upload)? That is the contract check surfaced in Provider Setup.
 *
 * Pure and side-effect free, so both the server layer and the tests use it.
 */
import { EDI_PATHS } from "@/lib/ediTransport";

export type EdiCatalogIndex = {
  /** Every distinct `/api/...` path the catalog mentions. */
  paths: string[];
  /** Dotted catalog key -> path, e.g. `endpoints.claims.list`. */
  byKey: Record<string, string>;
  /** True when the payload contained no recognisable endpoint at all. */
  empty: boolean;
};

const MAX_DEPTH = 8;

function looksLikePath(value: unknown): value is string {
  return typeof value === "string" && /^\/api\//.test(value.trim());
}

/** Flattens any catalog shape into `{ dotted key -> path }` plus a path list. */
export function indexEdiCatalog(payload: unknown): EdiCatalogIndex {
  const byKey: Record<string, string> = {};
  const paths = new Set<string>();

  const walk = (node: unknown, key: string, depth: number): void => {
    if (depth > MAX_DEPTH || node === null || node === undefined) return;
    if (looksLikePath(node)) {
      const path = node.trim();
      if (key) byKey[key] = path;
      paths.add(path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, key ? `${key}.${i}` : String(i), depth + 1));
      return;
    }
    if (typeof node === "object") {
      const rec = node as Record<string, unknown>;
      // `{ name: "claims", path: "/api/v1/claims/" }` style entries key on name.
      const label =
        typeof rec["name"] === "string"
          ? String(rec["name"])
          : typeof rec["key"] === "string"
            ? String(rec["key"])
            : null;
      for (const [childKey, child] of Object.entries(rec)) {
        const nextKey =
          label && (childKey === "path" || childKey === "url" || childKey === "endpoint")
            ? key
              ? `${key}.${label}`
              : label
            : key
              ? `${key}.${childKey}`
              : childKey;
        walk(child, nextKey, depth + 1);
      }
    }
  };

  walk(payload, "", 0);
  return { byKey, paths: [...paths].sort(), empty: paths.size === 0 };
}

/* ------------------------------------------------------------------ */
/* Entity discovery                                                    */
/* ------------------------------------------------------------------ */

export type EdiEntityKind = "provider" | "trading_partner" | "patient" | "trip" | "claim_from_trip";

type Hints = { keys: RegExp[]; paths: RegExp[] };

export const EDI_ENTITY_HINTS: Record<EdiEntityKind, Hints> = {
  provider: {
    keys: [/provider[_-]?profile/i, /\bproviders?\b/i, /billing[_-]?provider/i],
    paths: [/\/provider[-_]?profiles?\//i, /\/providers?\//i],
  },
  trading_partner: {
    keys: [/trading[_-]?partners?/i, /\bpartners?\b/i],
    paths: [/\/trading[-_]?partners?\//i],
  },
  patient: {
    keys: [/\bpatients?\b/i, /\bmembers?\b/i],
    paths: [/\/patients?\//i, /\/members?\//i],
  },
  trip: {
    keys: [/nemt[_-]?trips?/i, /\btrips?\b/i],
    paths: [/\/nemt[-_]?trips?\//i, /\/trips?\//i],
  },
  claim_from_trip: {
    keys: [/from[_-]?trip/i],
    paths: [/\/claims\/from-trip\//i],
  },
};

/** A collection endpoint: no `{id}` / `:id` placeholder, no trailing action. */
function isCollectionPath(path: string): boolean {
  if (/[{}<>:]/.test(path)) return false;
  return path.endsWith("/");
}

/**
 * The path this backend exposes for the entity, or null when it does not
 * advertise one. Never falls back to a guessed path.
 */
export function resolveEdiEntityPath(
  index: EdiCatalogIndex,
  kind: EdiEntityKind,
): string | null {
  const hints = EDI_ENTITY_HINTS[kind];

  const keyed = Object.entries(index.byKey)
    .filter(([key, path]) => isCollectionPath(path) && hints.keys.some((r) => r.test(key)))
    .map(([, path]) => path)
    .sort((a, b) => a.length - b.length);
  if (keyed[0]) return keyed[0];

  const matched = index.paths
    .filter((p) => isCollectionPath(p) && hints.paths.some((r) => r.test(p)))
    .sort((a, b) => a.length - b.length);
  return matched[0] ?? null;
}

/** Every entity path this backend advertises (nulls included, for reporting). */
export function resolveEdiEntityPaths(
  index: EdiCatalogIndex,
): Record<EdiEntityKind, string | null> {
  return {
    provider: resolveEdiEntityPath(index, "provider"),
    trading_partner: resolveEdiEntityPath(index, "trading_partner"),
    patient: resolveEdiEntityPath(index, "patient"),
    trip: resolveEdiEntityPath(index, "trip"),
    claim_from_trip: resolveEdiEntityPath(index, "claim_from_trip"),
  };
}

/** `/api/v1/patients/` + `12` -> `/api/v1/patients/12/` */
export function entityDetailPath(collection: string, id: number | string): string {
  const base = collection.endsWith("/") ? collection : `${collection}/`;
  return `${base}${encodeURIComponent(String(id))}/`;
}

/* ------------------------------------------------------------------ */
/* Documented contract check                                           */
/* ------------------------------------------------------------------ */

export type EdiContractRow = {
  key: string;
  path: string;
  /** The catalog mentions this exact path. */
  advertised: boolean;
  /** The catalog mentions the same collection with an id placeholder. */
  family: boolean;
};

const DOCUMENTED: { key: string; path: string }[] = [
  { key: "health", path: EDI_PATHS.health() },
  { key: "integration catalog", path: EDI_PATHS.integrationCatalog() },
  { key: "claims", path: EDI_PATHS.claims() },
  { key: "claim from trip", path: EDI_PATHS.claimFromTrip() },
  { key: "claim validate", path: EDI_PATHS.claimValidate("{id}") },
  { key: "claim status", path: EDI_PATHS.claimStatus("{id}") },
  { key: "submission batches", path: EDI_PATHS.batches() },
  { key: "batch add-claim", path: EDI_PATHS.batchAddClaim("{id}") },
  { key: "generate 837P", path: EDI_PATHS.generate837p() },
  { key: "837P file upload", path: EDI_PATHS.ediFileUpload("{id}") },
];

/** Same path with any id segment reduced to `*`, for family comparison. */
function shape(path: string): string {
  return path
    .replace(/%7B/gi, "{")
    .replace(/%7D/gi, "}")
    .replace(/\/(\d+|\{[^/]*\}|:[^/]+)\//g, "/*/");
}

/**
 * Compares the documented endpoints this app calls against what the backend
 * catalog advertises. Read-only: it never calls any of them.
 */
export function ediContractReport(index: EdiCatalogIndex): EdiContractRow[] {
  const shapes = new Set(index.paths.map(shape));
  return DOCUMENTED.map((row) => ({
    key: row.key,
    path: row.path.replace(/%7B/gi, "{").replace(/%7D/gi, "}"),
    advertised: index.paths.includes(row.path),
    family: shapes.has(shape(row.path)),
  }));
}

/** Human summary of the contract check. */
export function ediContractSummary(rows: EdiContractRow[]): {
  ok: boolean;
  missing: string[];
  message: string;
} {
  const missing = rows.filter((r) => !r.advertised && !r.family).map((r) => r.key);
  if (!rows.length)
    return { ok: false, missing: [], message: "The backend returned no endpoint catalog." };
  if (!missing.length)
    return { ok: true, missing, message: "Every documented endpoint is advertised by the backend." };
  return {
    ok: false,
    missing,
    message: `The backend catalog does not advertise: ${missing.join(", ")}.`,
  };
}
