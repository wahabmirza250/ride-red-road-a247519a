/**
 * Trip-scoped READ-ONLY HCPF search against the dedicated claim-status checker.
 *
 *   POST /search-claim-by-trip { company_id, member_id, service_date, trip_id }
 *     -> { jobId }
 *   GET  /job-status/:jobId
 *     -> { status, result: { result_state, match_count, claims[] } }
 *
 * This module NEVER submits, resubmits, edits or deletes anything. It is used
 * to reconcile billing records that look submitted but carry no claim ID.
 */
import {
  CLAIM_STATUS_CHECKER_URL,
  CHECK_POLL_TIMEOUT_MS,
  isFinalCheckerJobState,
  pollIntervalMs,
} from "@/lib/claimStatusSync.server";
import { COMPANY_ID_CONFIG_ERROR, normalizeCompanyId } from "@/lib/companyUuid";
import { normalizeTripClaims, type TripSearchOutcome } from "@/lib/tripClaimSearch";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env["ROBOT_API_KEY"] ?? process.env["CLAIM_STATUS_API_KEY"];
  if (key) h["x-api-key"] = key;
  return h;
}

export async function searchClaimByTrip(args: {
  companyId: string | null;
  memberId: string;
  /** Portal-formatted service date (MM/DD/YYYY). */
  serviceDate: string;
  tripId: string | null;
  doFetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<TripSearchOutcome> {
  const doFetch = args.doFetch ?? fetch;
  const headers = authHeaders();
  const none = (unavailable: boolean, detail: string): TripSearchOutcome => ({
    ok: false,
    unavailable,
    result_state: null,
    match_count: null,
    claims: [],
    detail,
  });

  // The checker resolves the portal login from `company_id`, so a portal
  // account key here costs a portal session and comes back as
  // "company_id must be a UUID". Refuse locally instead.
  const companyId = normalizeCompanyId(args.companyId);
  if (!companyId) return none(true, COMPANY_ID_CONFIG_ERROR);

  let jobId = "";
  try {
    const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/search-claim-by-trip`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        company_id: companyId,
        member_id: args.memberId,
        service_date: args.serviceDate,
        trip_id: args.tripId,
      }),
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return none(true, "the checker service has no trip search route yet");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return none(true, `trip search failed (HTTP ${res.status}) ${body.slice(0, 120)}`.trim());
    }
    const body: any = await res.json().catch(() => ({}));
    jobId = String(body?.jobId ?? body?.job_id ?? "");
    if (!jobId) return none(true, "the checker did not return a job id");
  } catch (e: any) {
    return none(true, `the checker service is unreachable: ${e?.message ?? e}`);
  }

  const deadline = Date.now() + (args.timeoutMs ?? CHECK_POLL_TIMEOUT_MS);
  let poll = 0;
  while (Date.now() < deadline) {
    const wait = Math.min(pollIntervalMs(poll++), Math.max(0, deadline - Date.now()));
    await new Promise((r) => setTimeout(r, wait));
    let body: any;
    try {
      const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/job-status/${jobId}`, { headers });
      if (!res.ok) continue;
      body = await res.json().catch(() => ({}));
    } catch {
      continue;
    }
    const state = String(body?.status ?? "").toLowerCase();
    if (!isFinalCheckerJobState(state)) continue;
    if (state !== "done" && state !== "completed" && state !== "success") {
      const cause = String(body?.error ?? body?.result?.error ?? "no detail").replace(/\s+/g, " ");
      return none(true, `trip search ${state}: ${cause.slice(0, 200)}`);
    }
    const result: any = body?.result ?? {};
    const claims = normalizeTripClaims(result);
    const matchCount =
      typeof result?.match_count === "number" ? result.match_count : claims.length;
    return {
      ok: true,
      unavailable: false,
      result_state: result?.result_state ? String(result.result_state) : null,
      match_count: matchCount,
      claims,
      detail: "/search-claim-by-trip",
    };
  }
  return none(true, "the trip search job did not finish in time");
}
