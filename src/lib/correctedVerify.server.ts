/**
 * READ-ONLY VERIFICATION SWEEP FOR HELD CORRECTED RESUBMISSIONS (server-only).
 *
 * A corrected claim whose robot run ended ambiguous (480s timeout, unreadable
 * Charge Amount input, lost job) may already exist at HCPF. This sweep settles
 * it the only safe way: a READ-ONLY portal search by member Medicaid ID +
 * corrected service date, on the same provider/account and sticky session rules
 * the status checker already uses.
 *
 * HARD GUARANTEES
 *   - never clicks Submit/Resubmit, never recreates or retries the held job;
 *   - never writes `medicaid_trips` or the original denied billing record;
 *   - attaches a claim ONLY when exactly one unused claim exists whose id
 *     differs from `original_claim_number`;
 *   - zero or multiple matches keep the Verification Hold, with the precise
 *     portal answer recorded for the biller.
 */
import { logAudit, denverDateISO } from "@/lib/billingHelpers";
import { markCorrectedSubmitted } from "@/lib/correctedReconcile.server";
import { VERIFIABLE_CORRECTED_CODES, pickCorrectedMatch } from "@/lib/correctedVerify";
import { portalDateMDY } from "@/lib/hcpfSearch.server";
import { normalizePortalStatus } from "@/lib/portalStatus";
import { portalMoneyNumber } from "@/lib/portalCurrency";
import { writeResubmissionEvent } from "@/lib/resubmissionLifecycle.server";
import { searchClaimByTrip } from "@/lib/tripClaimSearch.server";
import type { PortalClaim } from "@/lib/hcpfSearch";

type Sb = any;

export type CorrectedVerifyOutcome = {
  record_id: string;
  resubmission_id: string;
  kind: "unique" | "none" | "multiple" | "error";
  claim_id?: string | null;
  detail: string;
};

export type CorrectedVerifySummary = {
  checked: number;
  unique: number;
  none: number;
  multiple: number;
  errors: number;
  attached: { record_id: string; resubmission_id: string; claim_id: string; status: string | null }[];
  outcomes: CorrectedVerifyOutcome[];
};

const SELECT = `id, trip_id, company_id, resubmission_id, failure_code, status,
   medicaid_trips!inner(id, pickup_at, rider_id, riders(medicaid_id)),
   claim_resubmissions!billing_records_resubmission_id_fkey(
     id, status, original_claim_number, draft_snapshot
   )`;

/** Claim ids already attached to ANY bill in the company (excluding this one). */
async function usedClaimNumbers(
  supabase: Sb,
  companyId: string | null,
  recordId: string,
  ids: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  let q = supabase
    .from("billing_records")
    .select("id, state_confirmation_number")
    .in("state_confirmation_number", ids);
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q;
  for (const r of (data ?? []) as any[]) {
    if (r.id === recordId) continue;
    if (r.state_confirmation_number) out.add(String(r.state_confirmation_number));
  }
  return out;
}

async function keepHold(
  supabase: Sb,
  args: {
    recordId: string;
    resubmissionId: string;
    companyId: string | null;
    message: string;
    actorId: string | null;
  },
) {
  await supabase
    .from("billing_records")
    .update({
      submission_error: args.message,
      submit_last_error: args.message.slice(0, 500),
      fix_notes: args.message,
      requires_human_step: true,
      // No retry is ever scheduled by this sweep.
      submit_next_attempt_at: null,
    })
    .eq("id", args.recordId);
  await supabase
    .from("claim_resubmissions")
    .update({ failure_reason: args.message })
    .eq("id", args.resubmissionId)
    .eq("status", "processing");
  await logAudit(
    supabase,
    args.recordId,
    args.actorId,
    "corrected_claim_readonly_search",
    args.message,
    "system",
  );
  await writeResubmissionEvent(supabase, {
    resubmission_id: args.resubmissionId,
    company_id: args.companyId,
    actor_id: args.actorId,
    action: "resubmission_readonly_search",
    notes: args.message,
  });
}

/** Copy ONLY the portal's own money/status onto the corrected rows. */
async function applyPortalFinancials(
  supabase: Sb,
  args: { recordId: string; resubmissionId: string; claim: PortalClaim },
) {
  const patch: Record<string, unknown> = {};
  const paid = portalMoneyNumber(args.claim.paid_amount);
  const charged = portalMoneyNumber(args.claim.charge_amount);
  if (paid !== null) patch["portal_paid_amount"] = paid;
  if (charged !== null) patch["portal_charged_amount"] = charged;
  if (args.claim.status) patch["portal_status_raw"] = args.claim.status;
  const canonical = normalizePortalStatus(args.claim.status);
  if (canonical === "paid" || canonical === "denied" || canonical === "rejected") {
    patch["status"] = canonical;
  }
  if (Object.keys(patch).length)
    await supabase.from("billing_records").update(patch).eq("id", args.recordId);
  if (canonical === "paid" || canonical === "denied") {
    await supabase
      .from("claim_resubmissions")
      .update({ status: canonical })
      .eq("id", args.resubmissionId)
      .eq("status", "submitted");
  }
  return canonical;
}

/**
 * Verify held corrected resubmissions. Bounded, idempotent, read-only at HCPF.
 * `recordIds` restricts the sweep to an exact set of bills.
 */
export async function verifyHeldCorrectedRecords(
  supabase: Sb,
  opts: {
    companyId?: string | null;
    recordIds?: string[] | null;
    actorId?: string | null;
    limit?: number;
  } = {},
): Promise<CorrectedVerifySummary> {
  const summary: CorrectedVerifySummary = {
    checked: 0,
    unique: 0,
    none: 0,
    multiple: 0,
    errors: 0,
    attached: [],
    outcomes: [],
  };
  const actorId = opts.actorId ?? null;

  let q = supabase
    .from("billing_records")
    .select(SELECT)
    .not("resubmission_id", "is", null)
    .in("failure_code", [...VERIFIABLE_CORRECTED_CODES])
    .limit(opts.limit ?? 25);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.recordIds?.length) q = q.in("id", opts.recordIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as any[]) {
    const res = Array.isArray(row.claim_resubmissions)
      ? row.claim_resubmissions[0]
      : row.claim_resubmissions;
    if (!res || res.status !== "processing") continue;
    summary.checked++;
    const snapshot = res.draft_snapshot ?? {};
    const memberId = String(snapshot?.medicaid_id ?? row.medicaid_trips?.riders?.medicaid_id ?? "").trim();
    const serviceIso = denverDateISO(
      String(snapshot?.service_date ?? row.medicaid_trips?.pickup_at ?? "") || undefined,
    );
    const record = { recordId: row.id, resubmissionId: res.id, companyId: row.company_id ?? null };

    if (!memberId) {
      summary.errors++;
      summary.outcomes.push({
        record_id: row.id,
        resubmission_id: res.id,
        kind: "error",
        detail: "No Medicaid member ID on the corrected draft, so HCPF cannot be searched.",
      });
      continue;
    }

    const search = await searchClaimByTrip({
      companyId: row.company_id ?? null,
      memberId,
      serviceDate: portalDateMDY(serviceIso),
      tripId: row.trip_id ?? null,
    });

    if (!search.ok) {
      summary.errors++;
      const msg = `Read-only HCPF verification could not run (${search.detail}). The corrected claim stays on Verification Hold — nothing was submitted or retried.`;
      await keepHold(supabase, { ...record, message: msg, actorId });
      summary.outcomes.push({
        record_id: row.id,
        resubmission_id: res.id,
        kind: "error",
        detail: search.detail,
      });
      continue;
    }

    const used = await usedClaimNumbers(
      supabase,
      row.company_id ?? null,
      row.id,
      search.claims.map((c) => c.claim_id),
    );
    const match = pickCorrectedMatch({
      claims: search.claims,
      originalClaimNumber: res.original_claim_number,
      usedClaimNumbers: used,
    });

    if (match.kind === "unique") {
      const nowIso = new Date().toISOString();
      const msg = `${match.reason} It was attached to this corrected bill by a READ-ONLY portal search on member ${memberId} for ${portalDateMDY(
        serviceIso,
      )} — nothing was submitted, resubmitted or retried. The original denied claim #${
        res.original_claim_number ?? "unknown"
      } is unchanged.`;
      await markCorrectedSubmitted(supabase, {
        recordId: row.id,
        resubmissionId: res.id,
        companyId: row.company_id ?? null,
        claimNumber: match.claim.claim_id,
        message: msg,
        actorId,
        nowIso,
      });
      const canonical = await applyPortalFinancials(supabase, {
        recordId: row.id,
        resubmissionId: res.id,
        claim: match.claim,
      });
      summary.unique++;
      summary.attached.push({
        record_id: row.id,
        resubmission_id: res.id,
        claim_id: match.claim.claim_id,
        status: canonical,
      });
      summary.outcomes.push({
        record_id: row.id,
        resubmission_id: res.id,
        kind: "unique",
        claim_id: match.claim.claim_id,
        detail: match.reason,
      });
      continue;
    }

    const msg = `${match.reason} The corrected claim stays on Verification Hold for a person to decide. Read-only search only — nothing was submitted, resubmitted or retried.`;
    await keepHold(supabase, { ...record, message: msg, actorId });
    if (match.kind === "multiple") summary.multiple++;
    else summary.none++;
    summary.outcomes.push({
      record_id: row.id,
      resubmission_id: res.id,
      kind: match.kind,
      detail: match.reason,
    });
  }

  return summary;
}
