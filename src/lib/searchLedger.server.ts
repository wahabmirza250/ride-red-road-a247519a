/**
 * DURABLE READ-ONLY CLAIM SEARCH (server-only).
 *
 * One search per bill, remembered in `claim_search_jobs`. A tick either polls
 * the job that is already running or, when nothing is running and the backoff
 * has elapsed, starts exactly one new search. It never submits, resubmits,
 * edits or deletes anything at HCPF.
 */
import {
  CLAIM_STATUS_CHECKER_URL,
  isFinalCheckerJobState,
} from "@/lib/claimStatusSync.server";
import { COMPANY_ID_CONFIG_ERROR, normalizeCompanyId } from "@/lib/companyUuid";
import { normalizeTripClaims } from "@/lib/tripClaimSearch";
import type { TripSearchOutcome } from "@/lib/tripClaimSearch";
import type { PortalClaim } from "@/lib/hcpfSearch";
import {
  nextSearchAction,
  searchBackoffMs,
  searchPollDelayMs,
  type SearchLedgerRow,
} from "@/lib/searchLedger";

type Sb = any;

export type DurableSearchResult =
  | { state: "pending"; detail: string }
  | { state: "exhausted"; detail: string }
  | { state: "answered"; outcome: TripSearchOutcome }
  | { state: "error"; detail: string };

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env["ROBOT_API_KEY"] ?? process.env["CLAIM_STATUS_API_KEY"];
  if (key) h["x-api-key"] = key;
  return h;
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

async function loadRow(
  supabase: Sb,
  recordId: string,
  purpose: string,
): Promise<SearchLedgerRow | null> {
  const { data } = await supabase
    .from("claim_search_jobs")
    .select("id, job_id, state, started_at, last_polled_at, poll_attempts, post_attempts, next_attempt_at")
    .eq("billing_record_id", recordId)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SearchLedgerRow | null) ?? null;
}

/**
 * Advance the read-only search for one bill by exactly one step.
 *
 * `doFetch` is injectable so tests never touch the network.
 */
export async function stepTripSearch(
  supabase: Sb,
  args: {
    recordId: string;
    tripId: string | null;
    companyId: string | null;
    memberId: string;
    serviceDate: string;
    purpose?: string;
    doFetch?: typeof fetch;
    now?: number;
  },
): Promise<DurableSearchResult> {
  const purpose = args.purpose ?? "corrected_verify";
  const doFetch = args.doFetch ?? fetch;
  const now = args.now ?? Date.now();
  const companyId = normalizeCompanyId(args.companyId);
  if (!companyId) return { state: "error", detail: COMPANY_ID_CONFIG_ERROR };

  const row = await loadRow(supabase, args.recordId, purpose);
  const action = nextSearchAction(row, now);

  if (action.kind === "exhausted") return { state: "exhausted", detail: action.reason };

  if (action.kind === "wait") {
    if (action.reason === "job-expired" && row?.id) {
      // The job outlived its window. That is NOT "no claim" — retry later.
      const posts = Number(row.post_attempts ?? 1);
      await supabase
        .from("claim_search_jobs")
        .update({
          state: "error",
          finished_at: new Date(now).toISOString(),
          last_error: "the portal search job never finished",
          next_attempt_at: iso(searchBackoffMs(posts)),
        })
        .eq("id", row.id);
      return { state: "pending", detail: "the portal search job never finished; it will be retried" };
    }
    if (action.reason === "already answered" && row?.id) {
      const { data } = await supabase
        .from("claim_search_jobs")
        .select("result_state, match_count, claims")
        .eq("id", row.id)
        .maybeSingle();
      if (data?.result_state)
        return {
          state: "answered",
          outcome: {
            ok: true,
            unavailable: false,
            result_state: String(data.result_state),
            match_count: Number(data.match_count ?? 0),
            claims: (data.claims ?? []) as PortalClaim[],
            detail: "/search-claim-by-trip (stored answer)",
          },
        };
    }
    return { state: "pending", detail: action.reason };
  }

  if (action.kind === "start") {
    const posts = Number(row?.post_attempts ?? 0) + 1;
    let jobId = "";
    let error: string | null = null;
    try {
      const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/search-claim-by-trip`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          company_id: companyId,
          member_id: args.memberId,
          service_date: args.serviceDate,
          trip_id: args.tripId,
        }),
      });
      if (!res.ok) error = `the portal search could not be started (HTTP ${res.status})`;
      else {
        const body: any = await res.json().catch(() => ({}));
        jobId = String(body?.jobId ?? body?.job_id ?? "");
        if (!jobId) error = "the checker did not return a job id";
      }
    } catch (e: any) {
      error = `the checker service is unreachable: ${e?.message ?? e}`;
    }

    const base = {
      billing_record_id: args.recordId,
      trip_id: args.tripId,
      company_id: companyId,
      purpose,
      member_id: args.memberId,
      service_date: args.serviceDate,
      post_attempts: posts,
      poll_attempts: 0,
      started_at: new Date(now).toISOString(),
      last_polled_at: null,
    };
    const patch = error
      ? {
          ...base,
          job_id: null,
          state: "error",
          last_error: error,
          finished_at: new Date(now).toISOString(),
          next_attempt_at: iso(searchBackoffMs(posts)),
        }
      : {
          ...base,
          job_id: jobId,
          state: "running",
          last_error: null,
          finished_at: null,
          next_attempt_at: iso(searchPollDelayMs(0)),
        };

    if (row?.id) await supabase.from("claim_search_jobs").update(patch).eq("id", row.id);
    else await supabase.from("claim_search_jobs").insert(patch);

    return error
      ? { state: "pending", detail: `${error} — it will be retried, this is not proof that no claim exists` }
      : { state: "pending", detail: "a read-only portal search is running" };
  }

  /* ---- poll an already-running job: no new POST, ever ---- */
  const polls = Number(row?.poll_attempts ?? 0) + 1;
  let body: any = null;
  let pollError: string | null = null;
  try {
    const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/job-status/${action.jobId}`, {
      headers: headers(),
    });
    if (!res.ok) pollError = `job status HTTP ${res.status}`;
    else body = await res.json().catch(() => ({}));
  } catch (e: any) {
    pollError = e?.message ?? "unreachable";
  }

  const touch: Record<string, unknown> = {
    poll_attempts: polls,
    last_polled_at: new Date(now).toISOString(),
    next_attempt_at: iso(searchPollDelayMs(polls)),
  };

  if (pollError || !isFinalCheckerJobState(String(body?.status ?? "").toLowerCase())) {
    if (pollError) touch["last_error"] = pollError;
    if (row?.id) await supabase.from("claim_search_jobs").update(touch).eq("id", row.id);
    return { state: "pending", detail: pollError ?? "the portal search is still running" };
  }

  const state = String(body?.status ?? "").toLowerCase();
  const posts = Number(row?.post_attempts ?? 1);
  if (state !== "done" && state !== "completed" && state !== "success") {
    const cause = String(body?.error ?? body?.result?.error ?? "no detail").replace(/\s+/g, " ");
    if (row?.id)
      await supabase
        .from("claim_search_jobs")
        .update({
          ...touch,
          state: "error",
          finished_at: new Date(now).toISOString(),
          last_error: `search ${state}: ${cause.slice(0, 200)}`,
          next_attempt_at: iso(searchBackoffMs(posts)),
        })
        .eq("id", row.id);
    return { state: "pending", detail: `the portal search ${state}; it will be retried` };
  }

  const result: any = body?.result ?? {};
  const claims = normalizeTripClaims(result);
  if (!result?.result_state && !claims.length) {
    // A finished job with no portal answer is a FAILED search, never "no claim".
    if (row?.id)
      await supabase
        .from("claim_search_jobs")
        .update({
          ...touch,
          state: "error",
          finished_at: new Date(now).toISOString(),
          last_error: "the portal did not answer",
          next_attempt_at: iso(searchBackoffMs(posts)),
        })
        .eq("id", row.id);
    return { state: "pending", detail: "the portal did not answer; the search will be retried" };
  }

  const resultState = result?.result_state ? String(result.result_state) : "RESULTS_FOUND";
  const matchCount = typeof result?.match_count === "number" ? result.match_count : claims.length;
  if (row?.id)
    await supabase
      .from("claim_search_jobs")
      .update({
        ...touch,
        state: "done",
        finished_at: new Date(now).toISOString(),
        result_state: resultState,
        match_count: matchCount,
        claims,
        last_error: null,
      })
      .eq("id", row.id);

  return {
    state: "answered",
    outcome: {
      ok: true,
      unavailable: false,
      result_state: resultState,
      match_count: matchCount,
      claims,
      detail: "/search-claim-by-trip",
    },
  };
}

/** Allow a fresh search after a biller acts on the bill (idempotent). */
export async function clearSearchLedger(supabase: Sb, recordId: string): Promise<void> {
  await supabase
    .from("claim_search_jobs")
    .update({ state: "closed", finished_at: new Date().toISOString() })
    .eq("billing_record_id", recordId)
    .eq("state", "running");
}
