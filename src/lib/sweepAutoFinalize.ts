/**
 * AUTOMATIC FINALIZATION OF SAFE SINGLE MATCHES (pure decisions, no I/O).
 *
 * A completed read-only sweep may contain rows where the portal returned
 * EXACTLY ONE unused claim for that member + service date, and that claim is
 * already in a final financial state (Paid / Denied / Rejected). Those rows
 * carry no ambiguity at all, so they are attached and moved to their real
 * final stage through the SAME audited writer a biller's "Confirm this claim"
 * uses. Everything else — several candidates, no result, an error, a claim id
 * already used by another bill, a mismatched member/date, or a non-final
 * portal status — stays exactly where it is for a human.
 *
 * Nothing here submits, resubmits, queues or edits anything at the portal.
 */
import type { PortalClaim } from "@/lib/hcpfSearch";
import { normalizePortalStatus } from "@/lib/portalStatus";

export const AUTO_FINAL_STATUSES = ["paid", "denied", "rejected"] as const;
export type AutoFinalStatus = (typeof AUTO_FINAL_STATUSES)[number];

export type AutoFinalizeRow = {
  id: string;
  billing_record_id: string;
  company_id?: string | null;
  member_id: string | null;
  service_date: string | null;
  outcome: string;
  candidates: PortalClaim[];
  confirmed_at?: string | null;
};

export type AutoFinalizeDecision =
  | { ok: true; claim: PortalClaim; status: AutoFinalStatus }
  | { ok: false; reason: string };

/** Digits only, so "P123-456" and "p123456" are the same member. */
export function memberKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** `M/D/YYYY`, `MM/DD/YYYY` and `YYYY-MM-DD` all compare equal. */
export function dateKey(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${Number(iso[1])}`;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (mdy) {
    const y = Number(mdy[3]);
    return `${Number(mdy[1])}/${Number(mdy[2])}/${y < 100 ? 2000 + y : y}`;
  }
  return s;
}

/**
 * May this sweep row be finalized automatically? Fail closed: any doubt at
 * all leaves the bill on Verification Hold for a biller.
 */
export function decideAutoFinalize(
  row: AutoFinalizeRow,
  opts: { companyId?: string | null } = {},
): AutoFinalizeDecision {
  if (row.confirmed_at) return { ok: false, reason: "Already resolved." };
  if (row.outcome !== "single") return { ok: false, reason: `Outcome is ${row.outcome}.` };

  const claims = Array.isArray(row.candidates) ? row.candidates : [];
  if (claims.length !== 1) return { ok: false, reason: "Not exactly one candidate claim." };
  const claim = claims[0]!;
  if (!String(claim.claim_id ?? "").trim())
    return { ok: false, reason: "The candidate has no claim number." };
  if (claim.linked) return { ok: false, reason: "That claim already belongs to another bill." };

  if (opts.companyId && row.company_id && opts.companyId !== row.company_id)
    return { ok: false, reason: "The result belongs to another company." };

  const wantMember = memberKey(row.member_id);
  const gotMember = memberKey(claim.member_id);
  if (!wantMember) return { ok: false, reason: "The bill has no Medicaid member ID." };
  if (gotMember && gotMember !== wantMember)
    return { ok: false, reason: "The claim's member ID does not match this bill." };

  const wantDate = dateKey(row.service_date);
  const gotDate = dateKey(claim.service_date);
  if (!wantDate) return { ok: false, reason: "The bill has no service date." };
  if (gotDate && gotDate !== wantDate)
    return { ok: false, reason: "The claim's service date does not match this bill." };

  const status = normalizePortalStatus(claim.status);
  if (!status || !(AUTO_FINAL_STATUSES as readonly string[]).includes(status))
    return {
      ok: false,
      reason: `The portal status "${claim.status ?? "unknown"}" is not a final Paid or Denied result.`,
    };

  return { ok: true, claim, status: status as AutoFinalStatus };
}

export type AutoFinalizeSummary = {
  finalized: number;
  skipped: { id: string; billing_record_id: string; reason: string }[];
};
