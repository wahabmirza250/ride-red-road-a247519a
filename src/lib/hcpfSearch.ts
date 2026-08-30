/**
 * READ-ONLY HCPF CLAIM SEARCH — shared, pure contract.
 *
 * Used by the Verify HCPF claim panel. Nothing in this module submits,
 * enqueues or mutates anything; it only describes what the portal returned and
 * whether it is safe to link a claim to a bill automatically.
 */

export type PortalClaim = {
  claim_id: string;
  status: string | null;
  service_date: string | null;
  paid_amount: number | null;
  charge_amount: number | null;
  units: number | null;
  member_id: string | null;
  /** Portal row label/index, when the checker reports one. */
  row?: string | null;
  /** Set when this claim number is already attached to another RedArt bill. */
  linked?: LinkedBill | null;
};

export type LinkedBill = {
  billing_record_id: string;
  trip_id: string | null;
  status: string | null;
  passenger_name: string | null;
  medicaid_id: string | null;
  service_date: string | null;
  odometer_start: number | null;
  odometer_end: number | null;
  miles: number | null;
};

export type HcpfSearchResult = {
  ok: boolean;
  /** true when the automation service has no read-only search available. */
  unavailable: boolean;
  message: string;
  member_id: string;
  service_date: string;
  claims: PortalClaim[];
};

export type LinkDecision =
  | { kind: "none"; reason: string }
  | { kind: "auto"; claim: PortalClaim; reason: string }
  | { kind: "manual"; reason: string };

/**
 * Safe matching rule.
 *  - 0 claims                                 -> nothing to link
 *  - exactly 1 unassigned claim, 1 trip today -> a one-click link is safe
 *  - anything else                            -> a human must pick, twice
 */
export function decideLink(args: {
  claims: PortalClaim[];
  sameDayTripCount: number;
}): LinkDecision {
  const claims = args.claims ?? [];
  if (claims.length === 0) return { kind: "none", reason: "No claim was returned for this member and service date." };
  const unassigned = claims.filter((c) => !c.linked);
  if (claims.length === 1 && unassigned.length === 1 && args.sameDayTripCount <= 1) {
    return {
      kind: "auto",
      claim: unassigned[0]!,
      reason: "Exactly one portal claim and one RedArt trip for this member and date.",
    };
  }
  if (unassigned.length === 0)
    return {
      kind: "manual",
      reason: "Every claim found is already linked to another RedArt bill. Nothing can be linked here.",
    };
  return {
    kind: "manual",
    reason:
      args.sameDayTripCount > 1
        ? "This member has more than one RedArt trip on this date — pick the matching claim yourself and confirm twice."
        : "More than one portal claim was returned — pick the matching claim yourself and confirm twice.",
  };
}

const DUPLICATE_PATTERNS = [
  /duplicate key value violates unique constraint/i,
  /billing_records_company_confirmation_uniq/i,
  /already linked to another/i,
];

export const CLAIM_CONFLICT_MESSAGE =
  "This HCPF claim is already linked to another RedArt bill";

/** Never let SQL text reach a biller. */
export function friendlyLinkError(raw: unknown): string {
  const msg =
    typeof raw === "string" ? raw : (raw as any)?.message ? String((raw as any).message) : "";
  if (!msg.trim()) return "Could not record the claim number.";
  if (DUPLICATE_PATTERNS.some((re) => re.test(msg))) return CLAIM_CONFLICT_MESSAGE;
  if (/\b(select|insert|update|constraint|pgrst|violates|relation)\b/i.test(msg))
    return CLAIM_CONFLICT_MESSAGE;
  return msg.length > 240 ? `${msg.slice(0, 237)}...` : msg;
}

export const CLAIM_CONFLICT_PREFIX = "CLAIM_CONFLICT:";

export function claimConflictError(bill: LinkedBill, claim: string): Error {
  return new Error(CLAIM_CONFLICT_PREFIX + JSON.stringify({ claim, bill }));
}

export function parseClaimConflict(
  e: unknown,
): { claim: string; bill: LinkedBill } | null {
  const msg = typeof e === "string" ? e : (e as any)?.message ? String((e as any).message) : "";
  const at = msg.indexOf(CLAIM_CONFLICT_PREFIX);
  if (at < 0) return null;
  try {
    return JSON.parse(msg.slice(at + CLAIM_CONFLICT_PREFIX.length));
  } catch {
    return null;
  }
}

export function money(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—";
}
