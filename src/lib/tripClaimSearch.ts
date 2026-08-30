/**
 * READ-ONLY trip-scoped HCPF claim search — pure contract.
 *
 * The dedicated claim-status checker exposes POST /search-claim-by-trip which
 * returns a jobId; the completed job carries `result_state`, `match_count` and
 * `claims[]`. Nothing in this flow submits, resubmits, edits or deletes a
 * claim: it only reports what the portal already shows.
 */
import type { PortalClaim } from "@/lib/hcpfSearch";

export type TripSearchOutcome = {
  ok: boolean;
  /** true when the checker has no trip search route / is unreachable. */
  unavailable: boolean;
  result_state: string | null;
  match_count: number | null;
  claims: PortalClaim[];
  detail: string;
};

const money = (v: unknown): number | null => {
  // Amounts come ONLY from HCPF. Unknown stays null — never 0, never derived.
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
};

/** Maps the checker's `claims[]` rows onto the shared PortalClaim shape. */
export function normalizeTripClaims(result: any): PortalClaim[] {
  const rows: any[] = Array.isArray(result?.claims) ? result.claims : [];
  const out: PortalClaim[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = text(r?.claim_id) ?? text(r?.claim_number) ?? text(r?.icn);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      claim_id: id,
      status: text(r?.status),
      service_date: text(r?.service_date),
      paid_amount: money(r?.paid_amount),
      charge_amount: money(r?.charged_amount ?? r?.charge_amount),
      units: money(r?.units),
      member_id: text(r?.member_id),
      row: text(r?.row),
    });
  }
  return out;
}

/** Result states that mean "the portal answered, and there is nothing there". */
export function isNoResultState(state: string | null | undefined): boolean {
  const s = String(state ?? "").toUpperCase();
  return s === "NO_RESULTS" || s === "NO_RESULTS_FOUND" || s === "NOT_FOUND";
}

export function isResultsState(state: string | null | undefined): boolean {
  const s = String(state ?? "").toUpperCase();
  return s === "RESULTS_FOUND" || s === "RESULTS";
}
