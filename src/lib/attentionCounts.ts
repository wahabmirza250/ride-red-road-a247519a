/**
 * READY TO SUBMIT / NEEDS ATTENTION — one predicate, one dataset.
 *
 * The badge used to be a head count ("approved minus flagged rows") while the
 * list applied the richer `needsAttention()` predicate (which also quarantines
 * bills whose TRIP carries an unverified robot status). A bill could therefore
 * be counted as Ready and then rendered in Needs Attention, leaving the Ready
 * tab empty under a non-zero badge.
 *
 * Both numbers now come from the same rows, flattened exactly like the list.
 */
import { needsAttention, type AttentionCandidate } from "@/lib/needsAttention";

export const ATTENTION_COUNT_SELECT = `id, status, requires_human_step, submission_error,
   submit_last_error, failure_code, state_confirmation_number,
   medicaid_trips!inner(robot_last_status, robot_confirmation_number, submitted_confirmation)`;

/** Statuses that can land in either stage. */
export const ATTENTION_COUNT_STATUSES = ["approved", "needs_fix"] as const;

/** Upper bound on rows scanned — these two stages are a human worklist. */
export const ATTENTION_COUNT_LIMIT = 1000;

/** Flatten a joined billing row into the shape the shared predicates expect. */
export function flattenAttentionRow(r: any): AttentionCandidate {
  const t = r?.medicaid_trips ?? {};
  return {
    status: r?.status ?? null,
    requires_human_step: r?.requires_human_step ?? null,
    submission_error: r?.submission_error ?? null,
    submit_last_error: r?.submit_last_error ?? null,
    failure_code: r?.failure_code ?? null,
    state_confirmation_number: r?.state_confirmation_number ?? null,
    robot_last_status: t?.robot_last_status ?? null,
    robot_confirmation_number: t?.robot_confirmation_number ?? null,
    submitted_confirmation: t?.submitted_confirmation ?? null,
  };
}

export function splitAttentionCounts(rows: any[]): {
  ready_to_submit: number;
  needs_attention: number;
} {
  let ready = 0;
  let attention = 0;
  for (const raw of rows ?? []) {
    const rec = flattenAttentionRow(raw);
    if (needsAttention(rec)) attention += 1;
    else if (String(rec.status ?? "") === "approved") ready += 1;
    else attention += 1; // a needs_fix row is always human work
  }
  return { ready_to_submit: ready, needs_attention: attention };
}

/**
 * THE stage decision. Badge, list and fallback all call exactly this, on rows
 * carrying exactly the fields below — a row fetched without `failure_code`,
 * `submit_last_error` or the trip's robot status can be classified differently
 * from the same row fetched with them, which is how a badge and a list drift
 * apart. Keep every fetch that feeds this on the same field set.
 */
export type BillingStage = "ready" | "attention";

export function stageOfFlatRow(rec: AttentionCandidate): BillingStage {
  if (needsAttention(rec)) return "attention";
  return String(rec.status ?? "") === "approved" ? "ready" : "attention";
}

/** Filter an already-mapped list page down to one stage. */
export function filterStage<T extends AttentionCandidate>(rows: T[], stage: BillingStage): T[] {
  return rows.filter((r) => stageOfFlatRow(r) === stage);
}
