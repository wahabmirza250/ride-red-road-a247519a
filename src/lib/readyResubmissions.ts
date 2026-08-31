/**
 * READY TO SUBMIT — CORRECTED RESUBMISSIONS (pure, client-safe).
 *
 * ROOT CAUSE THIS MODULE FIXES
 * ----------------------------
 * "Move corrected claim to Ready" writes `claim_resubmissions.status='queued'`
 * and deliberately leaves the ORIGINAL `medicaid_trips` / `billing_records`
 * row exactly as it was (denied/rejected, original claim number intact). The
 * Ready to Submit stage, however, only ever read ordinary billing_records with
 * status `approved`/`needs_fix`. A corrected claim therefore vanished from the
 * whole workspace: not denied any more (a draft exists), not ready (wrong
 * table), not submitted (nothing was sent).
 *
 * The Ready stage now reads a DISCRIMINATED UNION:
 *   - `kind: "bill"`      — ordinary ready billing_records (unchanged path)
 *   - `kind: "corrected"` — corrected resubmissions in `queued`
 *
 * `queued` is the canonical READY state for a resubmission: it means "saved,
 * validated and waiting for the owner to press Auto Pilot", never "sending".
 * No status is rewritten and no migration is needed, so the resubmissions that
 * already exist show up automatically.
 */
import { computeDraftBilling, type DraftBilling, type RateSetting } from "@/lib/resubmissionBilling";
import { normalizeSnapshot, type DraftSnapshot } from "@/lib/resubmissionDraft";

export type CorrectedReadyCandidate = {
  kind: "corrected";
  /** Resubmission row id — the selection/identity key for this candidate. */
  id: string;
  resubmission_id: string;
  company_id: string | null;
  original_trip_id: string;
  /** Kept visible but strictly separate: it is NEVER reused as a new claim. */
  original_claim_number: string | null;
  original_status: string | null;
  original_denial_reason: string | null;
  idempotency_key: string | null;
  draft_version: number;
  moved_to_ready_at: string | null;
  service_date: string | null;
  passenger_name: string | null;
  medicaid_id: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
  units: number;
  miles: number;
  miles_source: "odometer" | "override";
  total_amount: number | null;
  modifiers: string[];
  line_count: number;
  has_attachment: boolean;
  warnings: string[];
  /** Lifecycle state of the corrected copy (queued/processing/failed/...). */
  status?: string | null;
  /** The NEW portal confirmation. Never the original claim number. */
  resubmission_claim_number?: string | null;
  /** Why a corrected claim failed or was returned to Ready. */
  failure_reason?: string | null;
};

export type CorrectedRow = {
  id: string;
  company_id?: string | null;
  original_trip_id: string;
  original_claim_number?: string | null;
  original_status?: string | null;
  original_denial_reason?: string | null;
  idempotency_key?: string | null;
  draft_version?: number | null;
  submitted_at?: string | null;
  status?: string | null;
  draft_snapshot?: any;
  original_snapshot?: any;
  resubmission_claim_number?: string | null;
  failure_reason?: string | null;
};

export type CorrectedLine = {
  resubmission_id: string;
  line_index?: number | null;
  modifiers?: string[] | null;
};

/** Distinct, uppercased modifiers across the draft's saved service lines. */
export function modifiersOf(lines: CorrectedLine[]): string[] {
  const out = new Set<string>();
  for (const l of lines ?? [])
    for (const m of l.modifiers ?? []) {
      const code = String(m ?? "").trim().toUpperCase();
      if (code) out.add(code);
    }
  return [...out].sort();
}

/**
 * Build ONE ready card from the saved corrected draft. Every displayed number
 * comes from `draft_snapshot` + `claim_service_lines` through the SAME shared
 * calculator the editor uses — never from the original denied trip.
 */
export function buildCorrectedCandidate(args: {
  row: CorrectedRow;
  lines: CorrectedLine[];
  rates: RateSetting[];
  tripPdfPath?: string | null;
}): CorrectedReadyCandidate {
  const snap: DraftSnapshot = normalizeSnapshot(
    args.row.draft_snapshot ?? args.row.original_snapshot ?? {},
  );
  const billing: DraftBilling = computeDraftBilling(snap, args.rates ?? []);
  const lines = (args.lines ?? []).filter((l) => l.resubmission_id === args.row.id);
  return {
    kind: "corrected",
    id: args.row.id,
    resubmission_id: args.row.id,
    company_id: args.row.company_id ?? null,
    original_trip_id: args.row.original_trip_id,
    original_claim_number: args.row.original_claim_number ?? null,
    original_status: args.row.original_status ?? null,
    original_denial_reason: args.row.original_denial_reason ?? null,
    idempotency_key: args.row.idempotency_key ?? null,
    draft_version: Number(args.row.draft_version ?? 1),
    moved_to_ready_at: args.row.submitted_at ?? null,
    service_date: snap.service_date ?? null,
    passenger_name: snap.passenger_name ?? null,
    medicaid_id: snap.medicaid_id ?? null,
    driver_name: snap.driver_name ?? null,
    vehicle_type: snap.vehicle_type ?? null,
    units: billing.units,
    miles: billing.miles,
    miles_source: billing.miles_source,
    total_amount: billing.total,
    modifiers: modifiersOf(lines),
    line_count: lines.length || (snap.lines ?? []).length,
    has_attachment: Boolean(snap.state_pdf_path || args.tripPdfPath),
    warnings: billing.warnings.map((w) => w.message),
    status: args.row.status ?? null,
    resubmission_claim_number: args.row.resubmission_claim_number ?? null,
    failure_reason: args.row.failure_reason ?? null,
  };
}

/**
 * Strict de-duplication: one card per resubmission id, and never two cards
 * carrying the same idempotency key (which would be the same submit intent).
 */
export function dedupeCorrected(list: CorrectedReadyCandidate[]): CorrectedReadyCandidate[] {
  const byId = new Set<string>();
  const byKey = new Set<string>();
  const out: CorrectedReadyCandidate[] = [];
  for (const c of list ?? []) {
    if (byId.has(c.resubmission_id)) continue;
    const key = (c.idempotency_key ?? "").trim();
    if (key && byKey.has(key)) continue;
    byId.add(c.resubmission_id);
    if (key) byKey.add(key);
    out.push(c);
  }
  return out;
}

/** Free-text search across both candidate types. */
export function matchesSearch(
  row: {
    passenger_name?: string | null;
    medicaid_id?: string | null;
    driver_name?: string | null;
    original_claim_number?: string | null;
  },
  query: string,
): boolean {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return [row.passenger_name, row.medicaid_id, row.driver_name, row.original_claim_number]
    .map((v) => String(v ?? "").toLowerCase())
    .some((v) => v.includes(q));
}

export type ReadySort = "date_desc" | "date_asc" | "passenger" | "amount_desc";

export function sortCorrected(
  list: CorrectedReadyCandidate[],
  sort: ReadySort = "date_desc",
): CorrectedReadyCandidate[] {
  const rows = [...(list ?? [])];
  const time = (v: string | null) => (v ? new Date(v).getTime() || 0 : 0);
  switch (sort) {
    case "date_asc":
      return rows.sort((a, b) => time(a.service_date) - time(b.service_date));
    case "passenger":
      return rows.sort((a, b) =>
        String(a.passenger_name ?? "").localeCompare(String(b.passenger_name ?? "")),
      );
    case "amount_desc":
      return rows.sort((a, b) => Number(b.total_amount ?? 0) - Number(a.total_amount ?? 0));
    default:
      return rows.sort((a, b) => time(b.service_date) - time(a.service_date));
  }
}

/** Ready badge arithmetic: ordinary ready bills PLUS corrected resubmissions. */
export function readyTotal(ordinary: number, corrected: number): number {
  return Math.max(0, Math.floor(ordinary || 0)) + Math.max(0, Math.floor(corrected || 0));
}
