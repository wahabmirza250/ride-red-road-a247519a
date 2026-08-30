/**
 * CLAIMS HISTORY — shared, pure (client + server).
 *
 * One history, several sources. An automated claim lives on a billing record,
 * a legacy claim only on the medicaid trip, a hand-entered claim on
 * `manual_claim_records`. The UI must never expose that split, so every source
 * is normalised into the same row shape and deduplicated on
 * `company_id + claim number` — the only pair that identifies one real HCPF
 * claim.
 */

export type ClaimHistorySource = "portal" | "manual";

export type ClaimHistoryRow = {
  /** Trip id for portal rows, manual record id for manual rows. */
  id: string;
  /** Billing record id when the claim is an automated one. */
  record_id?: string | null;
  company_id: string | null;
  source: ClaimHistorySource;
  claim_id: string | null;
  member_name: string | null;
  medicaid_id: string | null;
  trip_date: string | null;
  submitted_at: string | null;
  /** Our own calculated/estimated charge — NEVER income. */
  total_amount: number | null;
  total_source: "captured" | "calculated" | "billing_records" | null;
  /** What the portal actually reports. Only these are real money. */
  portal_charged_amount?: number | null;
  portal_allowed_amount?: number | null;
  portal_paid_amount?: number | null;
  portal_paid_at?: string | null;
  status: string | null;
};

/** Normalised claim number: portals pad/space them inconsistently. */
export function normalizeClaimNumber(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\s-]/g, "")
    .toLowerCase();
}

/** Identity of one real claim: company + claim number. */
export function claimKey(row: Pick<ClaimHistoryRow, "company_id" | "claim_id">): string | null {
  const claim = normalizeClaimNumber(row.claim_id);
  if (!claim) return null;
  return `${row.company_id ?? "-"}|${claim}`;
}

/**
 * Merge sources, keeping the richest row per claim. A row that carries real
 * portal money or a billing record wins over a bare duplicate; rows without a
 * claim number are always kept (they cannot collide with anything).
 */
export function dedupeClaimHistory(rows: ClaimHistoryRow[]): ClaimHistoryRow[] {
  const score = (r: ClaimHistoryRow) =>
    (r.portal_paid_amount != null ? 4 : 0) +
    (r.record_id ? 2 : 0) +
    (r.submitted_at ? 1 : 0) +
    (r.total_amount != null ? 1 : 0);

  const byKey = new Map<string, ClaimHistoryRow>();
  const loose: ClaimHistoryRow[] = [];
  for (const r of rows) {
    const key = claimKey(r);
    if (!key) {
      loose.push(r);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev || score(r) > score(prev)) byKey.set(key, prev ? { ...prev, ...r } : r);
  }
  return [...byKey.values(), ...loose];
}

/** Does this row match a biller's search box? Exact claim number always wins. */
export function matchesClaimSearch(row: ClaimHistoryRow, term: string, extra = ""): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  if (normalizeClaimNumber(row.claim_id) === normalizeClaimNumber(q)) return true;
  return [row.member_name, row.medicaid_id, row.claim_id, extra]
    .map((v) => String(v ?? "").toLowerCase())
    .some((v) => v.includes(q));
}
