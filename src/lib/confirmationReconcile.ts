/**
 * ONE RULE SET FOR ATTACHING A PORTAL CONFIRMATION TO A BILL (pure).
 *
 * A bill can end up in Needs Fix with no claim number even though the portal
 * really did accept the claim: the robot recorded a 13-digit confirmation on the
 * trip, then the worker died / the poll never came back / the row was
 * quarantined. Money then sits unreconciled forever.
 *
 * Reconciling that is only safe when the evidence is overwhelming, so this
 * module is deliberately hard to satisfy. A confirmation may be attached ONLY
 * when ALL of these hold:
 *
 *   1. it is a real 13-digit HCPF claim number, and every confirmation column
 *      on the trip that has a value agrees on it;
 *   2. the bill does not already carry a (different) claim number;
 *   3. the bill is NOT a corrected resubmission draft — a corrected draft shares
 *      its trip with the ORIGINAL denied claim, so the trip's confirmation is
 *      the original's, never the correction's;
 *   4. an exact `robot_submitted` audit line for this bill names that number;
 *   5. a LATER read-only portal search / match audit line for this bill names
 *      the same number (the portal itself confirmed it exists);
 *   6. no other billing record anywhere already owns that claim number.
 *
 * Anything less is a "blocked" decision with a plain-language reason: the bill
 * stays exactly where it is and a person decides. Nothing in this module (or
 * the writer built on it) ever submits, resubmits, queues or retries.
 *
 * Pure — no data access, safe on the client.
 */
import {
  isPortalClaimNumber,
  normalizeClaimNumber,
  pickConfirmationNumber,
  sameClaimNumber,
} from "@/lib/claimConfirmation";

/** The audit line proving OUR robot reported a successful submit. */
export const ROBOT_SUBMITTED_AUDIT_ACTION = "robot_submitted";

/**
 * Audit lines written by READ-ONLY portal reads. One of these, dated at or
 * after the `robot_submitted` line and naming the same claim number, is the
 * portal's own confirmation that the claim exists.
 */
export const PORTAL_MATCH_AUDIT_ACTIONS = [
  "hcpf_auto_search",
  "hcpf_bulk_search",
  "hcpf_bulk_autolink",
  "hcpf_auto_finalized",
  "hcpf_claim_linked",
  "manual_verification_claim_found",
  "robot_submit_resolved_by_lookup",
  "corrected_claim_readonly_search",
] as const;

/** Action written when this reconciler attaches a confirmation. */
export const CONFIRMATION_RECONCILED_ACTION = "confirmation_reconciled";

export type ReconcileAuditEvent = {
  action?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

export type ReconcileRecordInput = {
  id?: string;
  status?: string | null;
  resubmission_id?: string | null;
  state_confirmation_number?: string | null;
  submitted_at?: string | null;
};

export type ReconcileTripInput = {
  portal_confirmation?: string | null;
  submitted_confirmation?: string | null;
  robot_confirmation_number?: string | null;
  robot_last_status?: string | null;
};

export type ConfirmationReconcileDecision =
  | { kind: "attach"; claimNumber: string; reason: string }
  | { kind: "noop"; claimNumber: string | null; reason: string }
  | { kind: "blocked"; claimNumber: string | null; reason: string };

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Does this audit line name the exact claim number? */
export function auditNamesClaim(event: ReconcileAuditEvent, claimNumber: string): boolean {
  const notes = normalizeClaimNumber(event.notes ?? "");
  if (!notes) return false;
  return notes.includes(normalizeClaimNumber(claimNumber));
}

export function findRobotSubmittedEvidence(
  audits: ReconcileAuditEvent[],
  claimNumber: string,
): ReconcileAuditEvent | null {
  const hits = (audits ?? []).filter(
    (a) => a.action === ROBOT_SUBMITTED_AUDIT_ACTION && auditNamesClaim(a, claimNumber),
  );
  if (!hits.length) return null;
  // Earliest submit line — later portal reads must come after it.
  return hits.reduce((a, b) => ((ms(a.created_at) ?? 0) <= (ms(b.created_at) ?? 0) ? a : b));
}

export function findPortalMatchEvidence(
  audits: ReconcileAuditEvent[],
  claimNumber: string,
  notBefore: string | null | undefined,
): ReconcileAuditEvent | null {
  const floor = ms(notBefore);
  const actions = new Set<string>(PORTAL_MATCH_AUDIT_ACTIONS as readonly string[]);
  const hits = (audits ?? []).filter((a) => {
    if (!a.action || !actions.has(a.action)) return false;
    if (!auditNamesClaim(a, claimNumber)) return false;
    if (floor === null) return true;
    const at = ms(a.created_at);
    return at !== null && at >= floor;
  });
  if (!hits.length) return null;
  return hits.reduce((a, b) => ((ms(a.created_at) ?? 0) >= (ms(b.created_at) ?? 0) ? a : b));
}

/**
 * Decide whether a portal confirmation may be attached to this bill.
 * Idempotent by construction: a bill that already owns the number is a `noop`.
 */
export function decideConfirmationReconcile(input: {
  record: ReconcileRecordInput;
  trip: ReconcileTripInput | null | undefined;
  audits: ReconcileAuditEvent[];
  /** True when ANY other billing record already owns the candidate number. */
  claimUsedByOtherRecord: boolean;
  /** Original denied claim number when the bill belongs to a resubmission. */
  originalClaimNumber?: string | null;
}): ConfirmationReconcileDecision {
  const rec = input.record ?? {};
  const existing = normalizeClaimNumber(rec.state_confirmation_number);
  // Read the candidate from the TRIP only. The bill's own value is the thing we
  // are comparing against, so mixing it in would hide a real disagreement.
  const pick = pickConfirmationNumber({
    portal_confirmation: input.trip?.portal_confirmation ?? null,
    submitted_confirmation: input.trip?.submitted_confirmation ?? null,
    robot_confirmation_number: input.trip?.robot_confirmation_number ?? null,
  });

  // Already reconciled — never write twice, never log twice.
  if (existing && isPortalClaimNumber(existing)) {
    if (pick.ok && !sameClaimNumber(pick.claimNumber, existing))
      return {
        kind: "blocked",
        claimNumber: existing,
        reason: `This bill already carries claim #${existing} but the trip shows #${pick.claimNumber}. A person must resolve the difference.`,
      };
    if (!pick.ok && pick.conflicting?.length)
      return {
        kind: "blocked",
        claimNumber: existing,
        reason: `This bill carries claim #${existing} while its trip shows ${pick.conflicting.join(
          " and ",
        )}. A person must resolve the difference.`,
      };
    return {
      kind: "noop",
      claimNumber: existing,
      reason: `This bill already carries HCPF claim #${existing}.`,
    };
  }
  if (existing)
    return {
      kind: "blocked",
      claimNumber: existing,
      reason: `The claim number stored on this bill ("${existing}") is not a 13-digit HCPF claim number, so it cannot be trusted.`,
    };


  // A corrected draft shares its trip with the original denied claim: the
  // trip's confirmation belongs to the ORIGINAL. Only the corrected read-only
  // verifier may settle those.
  if (rec.resubmission_id)
    return {
      kind: "blocked",
      claimNumber: pick.ok ? pick.claimNumber : null,
      reason:
        "This is a corrected resubmission draft. Its trip still shows the original denied claim number, so a claim can only be attached by the corrected-claim portal check.",
    };

  if (!pick.ok) return { kind: "blocked", claimNumber: null, reason: pick.reason };
  const claimNumber = pick.claimNumber;

  if (
    input.originalClaimNumber &&
    sameClaimNumber(input.originalClaimNumber, claimNumber)
  )
    return {
      kind: "blocked",
      claimNumber,
      reason: `#${claimNumber} is the ORIGINAL denied claim number, so it can never become this bill's new claim.`,
    };

  if (input.claimUsedByOtherRecord)
    return {
      kind: "blocked",
      claimNumber,
      reason: `HCPF claim #${claimNumber} is already linked to another RedArt bill, so it must not be attached here.`,
    };

  const submitEvent = findRobotSubmittedEvidence(input.audits ?? [], claimNumber);
  if (!submitEvent)
    return {
      kind: "blocked",
      claimNumber,
      reason: `There is no submission record naming claim #${claimNumber} for this bill, so the confirmation is unproven.`,
    };

  const portalEvent = findPortalMatchEvidence(
    input.audits ?? [],
    claimNumber,
    submitEvent.created_at ?? null,
  );
  if (!portalEvent)
    return {
      kind: "blocked",
      claimNumber,
      reason: `No later portal check has confirmed claim #${claimNumber} exists at HCPF. The bill stays as it is until a read-only portal check finds it.`,
    };

  return {
    kind: "attach",
    claimNumber,
    reason: `The robot recorded claim #${claimNumber} for this bill and a later read-only HCPF check found that exact claim, and no other bill uses it. The claim number was attached and the bill moved to Submitted. Nothing was submitted, resubmitted or retried.`,
  };
}
