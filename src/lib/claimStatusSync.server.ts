/**
 * AUTOMATIC CLAIM STATUS SYNC — READ-ONLY.
 *
 * Completely separate from the submission robot. This module NEVER submits,
 * confirms, adjusts or resubmits anything. It only asks the portal
 * "what is the current status of claim #X?" and writes the answer back.
 *
 * Safety rules baked in here:
 *   - Read-only contract on every request (`read_only: true`, no trip payload).
 *   - A bounded batch per run, a single-flight database lease, and a paused
 *     state that every entry point checks first.
 *   - It never competes with submissions: a company with a queued/submitting
 *     bill is skipped entirely for this run.
 *   - Uncertain answer = no change. Only a status the portal states plainly is
 *     written; anything else leaves the stored status exactly as it was.
 *   - Every real change is written to billing_audit_log with previous status,
 *     new status and the time it was observed.
 */

/** ---- Scaling configuration (env-backed, safe defaults) ----------------
 *  Every knob below can be tuned per environment without a code change. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
/** Max concurrent read-only status checks for ONE company. Conservative. */
export const maxPerCompany = () => envInt("CLAIM_STATUS_MAX_PER_COMPANY", 4);
/** Max concurrent read-only status checks across ALL companies. */
export const maxGlobal = () => envInt("CLAIM_STATUS_MAX_GLOBAL", 20);
/** How long a leased claim stays locked before it becomes eligible again. */
export const leaseSeconds = () => envInt("CLAIM_STATUS_LEASE_SECONDS", 180);

/** Never lease more than this many claims in one scheduler tick. */
export const SYNC_BATCH_SIZE = maxGlobal();
/** Hard wall-clock ceiling for one background tick. */
export const RUN_BUDGET_MS = envInt("CLAIM_STATUS_RUN_BUDGET_MS", 4 * 60 * 1000);
/** Much tighter ceiling for a manually kicked run so the UI never hangs. */
export const MANUAL_RUN_BUDGET_MS = envInt("CLAIM_STATUS_MANUAL_BUDGET_MS", 90 * 1000);
/** Fallback re-check age for rows that predate per-row scheduling. */
export const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;
/** First automatic re-check delay; doubles per attempt up to the ceiling. */
export const BACKOFF_BASE_MS = 15 * 60 * 1000;
export const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000;
/** Steady cadence for a claim still sitting in a non-terminal portal state. */
export const OPEN_RECHECK_MS = 6 * 60 * 60 * 1000;
/** Portal outcomes that end automatic polling. */
export const TERMINAL_STATUSES = ["paid", "denied", "rejected"];

/** Next due time after `attempts` consecutive inconclusive checks. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts)));
}
/** Statuses worth re-checking. Terminal outcomes are left alone. */
export const OPEN_STATUSES = ["submitted", "approved", "suspended"];



export const SYNC_ACTION = "claim_status_sync";

export type SyncClaimOutcome = {
  record_id: string;
  claim_number: string;
  previous: string | null;
  current: string | null;
  changed: boolean;
  note: string;
};

export type SyncRunResult = {
  ok: boolean;
  ran: boolean;
  reason?: string;
  checked: number;
  changed: number;
  unchanged: number;
  skipped: number;
  companies: number;
  outcomes: SyncClaimOutcome[];
};

/** Portal wording → the status we store. Anything unknown returns null. */
export function normalizePortalStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/\bpaid\b|payment issued|finalized payment/.test(s)) return "paid";
  if (/\bdenied\b|finalized denial/.test(s)) return "denied";
  if (/\breject/.test(s)) return "rejected";
  if (/suspend|\bpend(ed|ing)?\b|in process|in review/.test(s)) return "suspended";
  if (/\bapproved\b|accepted/.test(s)) return "approved";
  if (/\bsubmitted\b|received/.test(s)) return "submitted";
  return null;
}

type Candidate = {
  record_id: string;
  trip_id: string;
  company_id: string | null;
  status: string | null;
  attempts?: number;
  claim_number: string;
  member_id: string | null;
  service_date_iso: string | null;
};

type LookupRow = {
  claim_number: string;
  status: string | null;
  raw: string | null;
  paid_amount?: string | null;
  result_state?: string | null;
};

type LookupResult =
  | { ok: true; rows: LookupRow[]; tried: string[] }
  | { ok: false; detail: string; tried: string[] };

/** Dedicated READ-ONLY claim-status checker service (separate from the robot). */
export const CLAIM_STATUS_CHECKER_URL =
  process.env["CLAIM_STATUS_CHECKER_URL"] ??
  "https://redart-claim-status-checker-production.up.railway.app";

/** How long we wait for one claim lookup job before treating it as transient.
 *  The checker answers in ~15s; 2 minutes is a hard per-check ceiling. */
const CHECK_POLL_TIMEOUT_MS = envInt("CLAIM_STATUS_CHECK_TIMEOUT_MS", 120_000);
const CHECK_POLL_INTERVAL_MS = 3_000;


/** Look up ONE claim through the checker service (start job, poll until done). */
async function checkOneClaim(
  companyId: string | null,
  claimNumber: string,
  doFetch: typeof fetch,
): Promise<{ ok: true; row: LookupRow } | { ok: false; detail: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["ROBOT_API_KEY"] ?? process.env["CLAIM_STATUS_API_KEY"];
  if (apiKey) headers["x-api-key"] = apiKey;

  let jobId: string;
  try {
    const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/check-claim-status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ company_id: companyId, claim_id: claimNumber }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, detail: `checker HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    const body: any = await res.json().catch(() => ({}));
    jobId = String(body?.jobId ?? body?.job_id ?? "");
    if (!jobId) return { ok: false, detail: "checker did not return a job id" };
  } catch (e: any) {
    return { ok: false, detail: `checker unreachable: ${e?.message ?? e}` };
  }

  const deadline = Date.now() + CHECK_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CHECK_POLL_INTERVAL_MS));
    let body: any;
    try {
      const res = await doFetch(`${CLAIM_STATUS_CHECKER_URL}/job-status/${jobId}`, { headers });
      if (!res.ok) continue;
      body = await res.json().catch(() => ({}));
    } catch {
      continue;
    }
    const jobStatus = String(body?.status ?? "").toLowerCase();
    if (jobStatus === "running" || jobStatus === "started" || jobStatus === "pending") continue;

    if (jobStatus !== "done") {
      return { ok: false, detail: `checker job ${jobStatus || "unknown"}: ${String(body?.error ?? "").slice(0, 160)}` };
    }
    const result: any = body?.result ?? {};
    const state = String(result?.result_state ?? "");
    if (state !== "RESULTS_FOUND") {
      // No result / login trouble / portal hiccup: certainty required, so no change.
      return {
        ok: true,
        row: { claim_number: claimNumber, status: null, raw: null, result_state: state || "UNKNOWN" },
      };
    }
    const raw = result?.detected_status ?? null;
    return {
      ok: true,
      row: {
        claim_number: claimNumber,
        status: normalizePortalStatus(raw),
        raw: typeof raw === "string" ? raw : null,
        paid_amount: result?.paid_amount ?? null,
        result_state: state,
      },
    };
  }
  return { ok: false, detail: "checker job timed out" };
}

