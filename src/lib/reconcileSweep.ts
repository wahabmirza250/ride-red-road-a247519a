/**
 * BULK READ-ONLY HCPF RECONCILIATION SWEEP — pure contract.
 *
 * The sweep looks up every bill that is sitting in Needs Fix / Verification
 * Hold WITHOUT a saved HCPF claim number and records what the portal shows.
 *
 * Hard rules encoded here:
 *   - Nothing is ever submitted, resubmitted, edited, deleted or moved between
 *     queues by the sweep. It only stores search results.
 *   - A claim id is NEVER attached automatically, not even on a single match.
 *     Every outcome needs an explicit biller confirmation.
 *   - Unknown portal amounts stay null. Never 0, never estimated.
 */
import type { PortalClaim } from "@/lib/hcpfSearch";
import { isNoResultState, type TripSearchOutcome } from "@/lib/tripClaimSearch";

export type SweepOutcome = "pending" | "searching" | "single" | "none" | "multiple" | "error";

export type SweepResultRow = {
  id: string;
  billing_record_id: string;
  trip_id: string | null;
  member_id: string | null;
  service_date: string | null;
  outcome: SweepOutcome;
  candidates: PortalClaim[];
  match_count: number | null;
  result_state: string | null;
  error: string | null;
  attempts: number;
  searched_at: string | null;
  confirmed_at: string | null;
  confirm_kind: string | null;
  passenger_name?: string | null;
};

export type SweepProgress = {
  total: number;
  searched: number;
  single: number;
  none: number;
  multiple: number;
  errors: number;
  remaining: number;
  confirmed: number;
};

/**
 * Classify one read-only search.
 *
 *  error    — the lookup itself could not run (retryable, never a "no claim").
 *  none     — the portal answered and has nothing for this member + date.
 *  single   — exactly one candidate and it is not already used by another bill.
 *  multiple — anything else; a human picks. Same member/date with several
 *             trips is normal, so every candidate is kept and shown.
 */
export function classifySearch(out: TripSearchOutcome | { ok: false }): SweepOutcome {
  if (!out.ok) return "error";
  const res = out as TripSearchOutcome;
  const claims = res.claims ?? [];
  if (claims.length === 0) {
    // CERTAINTY REQUIRED. "No claim" is only recorded when the portal itself
    // said so. An empty answer with no result_state is what a failed portal
    // login (e.g. a bad credential lookup) looks like — that is a retryable
    // error, never a licence to resubmit.
    return isNoResultState(res.result_state) ? "none" : "error";
  }
  const unused = claims.filter((c) => !c.linked);
  if (claims.length === 1 && unused.length === 1) return "single";
  return "multiple";
}

/** Work order the biller sees: fastest, safest decisions first. */
export const OUTCOME_PRIORITY: Record<SweepOutcome, number> = {
  single: 0,
  none: 1,
  multiple: 2,
  error: 3,
  searching: 4,
  pending: 5,
};

export function sortByPriority<T extends { outcome: SweepOutcome; confirmed_at?: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ac = a.confirmed_at ? 1 : 0;
    const bc = b.confirmed_at ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return OUTCOME_PRIORITY[a.outcome] - OUTCOME_PRIORITY[b.outcome];
  });
}

export function summarize(rows: { outcome: SweepOutcome; confirmed_at?: string | null }[]): SweepProgress {
  const p: SweepProgress = {
    total: rows.length,
    searched: 0,
    single: 0,
    none: 0,
    multiple: 0,
    errors: 0,
    remaining: 0,
    confirmed: 0,
  };
  for (const r of rows) {
    if (r.confirmed_at) p.confirmed += 1;
    switch (r.outcome) {
      case "single":
        p.single += 1;
        p.searched += 1;
        break;
      case "none":
        p.none += 1;
        p.searched += 1;
        break;
      case "multiple":
        p.multiple += 1;
        p.searched += 1;
        break;
      case "error":
        p.errors += 1;
        break;
      default:
        p.remaining += 1;
    }
  }
  // Errors are retried by the sweep, so they still count as outstanding work.
  p.remaining += p.errors;
  return p;
}

/** One short line per outcome, safe for a biller (no portal HTML, no stacks). */
export function outcomeLabel(outcome: SweepOutcome): string {
  switch (outcome) {
    case "single":
      return "1 unused claim found — confirm to attach";
    case "none":
      return "No claim in HCPF — confirm to record";
    case "multiple":
      return "Several candidates — pick the matching claim";
    case "error":
      return "Lookup failed — will retry";
    case "searching":
      return "Searching HCPF…";
    default:
      return "Waiting for a portal slot";
  }
}

/** Never let portal HTML or a stack trace reach the UI or the audit log. */
export function sanitizeSweepError(raw: unknown): string {
  const msg = typeof raw === "string" ? raw : ((raw as any)?.message ?? "");
  const clean = String(msg)
    .replace(/<[^>]*>/g, " ")
    .replace(/\b(password|api[_-]?key|authorization|cookie|token)\b\s*[:=]\s*\S+/gi, "$1: [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "The read-only portal lookup could not run.";
  return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
}

/**
 * LIVE LINKAGE OVERLAY.
 *
 * `candidates[].linked` is a snapshot taken at search time. Bills get linked
 * afterwards (by a biller, by the status checker, by another sweep row), so a
 * stale snapshot must never be trusted to enable a Confirm button or an
 * automatic finalization. Every render and every action re-checks the claim id
 * against the live `billing_records` table and overwrites the snapshot — in
 * both directions: a claim linked since the search becomes linked, and a claim
 * whose old link disappeared becomes free again.
 *
 * A claim linked to the row's OWN bill is not a conflict.
 */
export function applyLiveLinks<T extends { billing_record_id: string; candidates: PortalClaim[] }>(
  rows: T[],
  live: Map<string, { billing_record_id: string; trip_id?: string | null; status?: string | null }>,
): T[] {
  return rows.map((row) => ({
    ...row,
    candidates: (row.candidates ?? []).map((c) => {
      const hit = live.get(String(c.claim_id ?? "").trim());
      if (!hit || hit.billing_record_id === row.billing_record_id) return { ...c, linked: null };
      return { ...c, linked: hit as PortalClaim["linked"] };
    }),
  }));
}

/** Every claim id mentioned by these rows, de-duplicated. */
export function candidateClaimIds(rows: { candidates: PortalClaim[] }[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of r.candidates ?? []) {
    const id = String(c.claim_id ?? "").trim();
    if (id) set.add(id);
  }
  return [...set];
}

export const CLAIM_ALREADY_LINKED_LABEL = "Claim already linked to another RedArt bill";
