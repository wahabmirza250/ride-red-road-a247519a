/**
 * ROBOT FLEET ORCHESTRATION (server-only).
 *
 * The HCPF automation service itself is frozen: this module only decides WHICH
 * copy of that service a job is sent to, using the exact same contract
 * (`POST /submit-claim` -> `GET /job-status/:jobId`).
 *
 * Design rules that must never be broken:
 *   - Backwards compatible: with no fleet configuration at all, the single
 *     `ROBOT_BASE_URL` is the one worker and behaviour is identical to today.
 *   - Deterministic company affinity: a company normally always lands on the
 *     same healthy worker so its portal session/cookies stay warm.
 *   - Fail over ONLY before a submission was accepted. Once a worker returns a
 *     job id, that assignment is sticky until terminal reconciliation.
 *   - Health probing is read-only and never touches the HCPF portal.
 *   - No URL or secret ever reaches browser code — this file is server-only.
 */
import { ROBOT_BASE_URL } from "@/lib/billingHelpers";
import { envInt } from "@/lib/submissionQueueEnv";

export type FleetWorker = {
  /** Stable key persisted next to the robot job id. */
  id: string;
  url: string;
  enabled: boolean;
  max_active_jobs: number;
  last_health_ok_at: string | null;
  last_health_error: string | null;
  failure_streak: number;
  unhealthy_until: string | null;
  source: "env" | "db";
};

/** Default per-worker capacity — matches today's single-service global cap. */
export const workerDefaultCapacity = () => envInt("ROBOT_WORKER_MAX_ACTIVE_JOBS", 20, 1, 200);
/** Hard ceiling on fleet-wide concurrent submissions, whatever the fleet says. */
export const fleetHardCeiling = () => envInt("SUBMIT_MAX_GLOBAL_CEILING", 400, 1, 5000);
/** Cooldown applied to a worker after a failed health/dispatch attempt. */
export const workerCooldownSeconds = () => envInt("ROBOT_WORKER_COOLDOWN_SECONDS", 120, 30, 3600);

/** Whole-fleet kill switch (submissions only — status checking is untouched). */
export function isFleetDisabled(): boolean {
  const raw = String(process.env["ROBOT_FLEET_DISABLED"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

/** Stable id derived from the host when the operator did not name the worker. */
export function workerIdFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  } catch {
    return normalizeUrl(url).replace(/[^a-z0-9.-]/gi, "-").toLowerCase() || "robot";
  }
}

/**
 * `ROBOT_BASE_URLS` accepts `url, url` or `id=url, id=url`.
 * Absent/empty -> the single legacy `ROBOT_BASE_URL`.
 */
export function parseFleetEnv(raw?: string | null): FleetWorker[] {
  const value = String(raw ?? process.env["ROBOT_BASE_URLS"] ?? "").trim();
  const entries = value
    ? value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : [ROBOT_BASE_URL];

  const seen = new Set<string>();
  const out: FleetWorker[] = [];
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    const id = eq > 0 ? entry.slice(0, eq).trim() : "";
    const url = normalizeUrl(eq > 0 ? entry.slice(eq + 1) : entry);
    if (!/^https?:\/\//i.test(url)) continue;
    const key = id || workerIdFromUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: key,
      url,
      enabled: true,
      max_active_jobs: workerDefaultCapacity(),
      last_health_ok_at: null,
      last_health_error: null,
      failure_streak: 0,
      unhealthy_until: null,
      source: "env",
    });
  }
  return out.length ? out : [];
}

/**
 * Merge the env-declared fleet with the DB registry. The DB is authoritative
 * for `enabled`, capacity and health; env declares which workers exist (and a
 * DB-only row can add one without a redeploy).
 */
export function mergeFleet(envWorkers: FleetWorker[], dbRows: any[]): FleetWorker[] {
  const byId = new Map<string, FleetWorker>();
  for (const w of envWorkers) byId.set(w.id, { ...w });
  for (const row of dbRows ?? []) {
    const id = String(row.id);
    const base = byId.get(id);
    const url = normalizeUrl(String(row.base_url ?? base?.url ?? ""));
    if (!/^https?:\/\//i.test(url)) continue;
    byId.set(id, {
      id,
      url,
      enabled: row.enabled !== false,
      max_active_jobs: Math.max(1, Number(row.max_active_jobs ?? workerDefaultCapacity())),
      last_health_ok_at: row.last_health_ok_at ?? null,
      last_health_error: row.last_health_error ?? null,
      failure_streak: Number(row.failure_streak ?? 0),
      unhealthy_until: row.unhealthy_until ?? null,
      source: base ? "env" : "db",
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadFleet(supabase: any): Promise<FleetWorker[]> {
  const envWorkers = parseFleetEnv();
  let rows: any[] = [];
  try {
    const { data } = await supabase.from("robot_workers").select("*");
    rows = data ?? [];
  } catch {
    /* registry is an enhancement — never block dispatch on it */
  }
  return mergeFleet(envWorkers, rows);
}

export function isWorkerHealthy(w: FleetWorker, now: number = Date.now()): boolean {
  if (!w.enabled) return false;
  if (w.unhealthy_until && new Date(w.unhealthy_until).getTime() > now) return false;
  return true;
}

export function healthyWorkers(fleet: FleetWorker[], now: number = Date.now()): FleetWorker[] {
  if (isFleetDisabled()) return [];
  return fleet.filter((w) => isWorkerHealthy(w, now));
}

/** Aggregate concurrent-job capacity of the healthy part of the fleet. */
export function fleetCapacity(fleet: FleetWorker[], now: number = Date.now()): number {
  return healthyWorkers(fleet, now).reduce((n, w) => n + Math.max(0, w.max_active_jobs), 0);
}

/**
 * How many leases the queue may hold fleet-wide right now.
 *
 * One worker (today's production shape) => unchanged: the configured
 * `SUBMIT_MAX_GLOBAL`, never more than that worker can actually run.
 * Several workers => scale with real aggregate capacity, under a hard ceiling.
 */
export function effectiveGlobalLimit(
  fleet: FleetWorker[],
  baseGlobal: number,
  now: number = Date.now(),
): number {
  const capacity = fleetCapacity(fleet, now);
  if (capacity <= 0) return 0;
  if (healthyWorkers(fleet, now).length <= 1) return Math.min(baseGlobal, capacity);
  return Math.min(fleetHardCeiling(), Math.max(baseGlobal, capacity));
}

/* ---------------- Deterministic company affinity ------------------------- */

/** FNV-1a — stable across processes and deploys, unlike Math.random or hashCode. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type WorkerLoad = Map<string, number>;

/**
 * Pick the worker for a company: its deterministic home worker when that one
 * is healthy and has room, otherwise the next healthy worker with room walking
 * the ring. Returns null when the whole healthy fleet is saturated.
 */
export function pickWorkerForCompany(
  fleet: FleetWorker[],
  companyId: string | null | undefined,
  load: WorkerLoad = new Map(),
  opts: { exclude?: string[]; now?: number; ignoreCapacity?: boolean } = {},
): FleetWorker | null {
  const now = opts.now ?? Date.now();
  const pool = healthyWorkers(fleet, now).filter((w) => !(opts.exclude ?? []).includes(w.id));
  if (pool.length === 0) return null;
  const home = hashString(String(companyId ?? "no-company")) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const w = pool[(home + i) % pool.length]!;
    if (opts.ignoreCapacity) return w;
    if ((load.get(w.id) ?? 0) < w.max_active_jobs) return w;
  }
  return null;
}

/** The company's home worker regardless of health — used for reporting/tests. */
export function homeWorkerForCompany(
  fleet: FleetWorker[],
  companyId: string | null | undefined,
): FleetWorker | null {
  const pool = [...fleet].sort((a, b) => a.id.localeCompare(b.id));
  if (!pool.length) return null;
  return pool[hashString(String(companyId ?? "no-company")) % pool.length]!;
}

/* ---------------- Live load ---------------------------------------------- */

/** Active (accepted, still in flight) jobs per worker, straight from the DB. */
export async function loadWorkerActiveCounts(supabase: any): Promise<WorkerLoad> {
  const load: WorkerLoad = new Map();
  try {
    const { data } = await supabase
      .from("billing_records")
      .select("id, medicaid_trips!inner(robot_job_id, robot_worker_id)")
      .eq("status", "submitting");
    for (const r of data ?? []) {
      const trip: any = r.medicaid_trips;
      if (!trip?.robot_job_id) continue;
      const id = trip.robot_worker_id ?? null;
      if (!id) continue;
      load.set(id, (load.get(id) ?? 0) + 1);
    }
  } catch {
    /* best effort */
  }
  return load;
}

/* ---------------- Health (read-only, never touches HCPF) ----------------- */

export async function recordWorkerHealth(
  supabase: any,
  worker: { id: string; url: string },
  ok: boolean,
  error?: string | null,
): Promise<void> {
  try {
    await supabase.rpc("record_robot_worker_health", {
      _id: worker.id,
      _base_url: worker.url,
      _ok: ok,
      _error: ok ? null : (error ?? "unknown error").slice(0, 500),
      _cooldown_seconds: workerCooldownSeconds(),
    });
  } catch {
    /* health bookkeeping must never break dispatch */
  }
}

/**
 * Read-only liveness probe of one worker process. It only calls the automation
 * service's own health surface — no portal login, no claim, no HCPF traffic.
 */
export async function probeWorker(
  worker: FleetWorker,
  timeoutMs = 5000,
): Promise<{ ok: boolean; ms: number; error: string | null }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${worker.url}/health`, { method: "GET", signal: ctrl.signal });
    // Any HTTP answer proves the process is up; only 5xx counts as unhealthy.
    const ok = res.status < 500;
    return { ok, ms: Date.now() - t0, error: ok ? null : `health ${res.status}` };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - t0, error: e?.message ?? "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeFleet(supabase: any): Promise<FleetWorker[]> {
  const fleet = await loadFleet(supabase);
  await Promise.all(
    fleet.map(async (w) => {
      if (!w.enabled) return;
      const r = await probeWorker(w);
      await recordWorkerHealth(supabase, w, r.ok, r.error);
    }),
  );
  return await loadFleet(supabase);
}

/* ---------------- Dispatch with pre-accept failover ---------------------- */

export type FleetDispatchResult = {
  jobId: string;
  workerId: string;
  workerUrl: string;
  failedOverFrom: string | null;
};

/**
 * Classify a dispatch failure.
 *
 * `pre_accept` — we can prove the worker never took the job (connection
 * refused/DNS/5xx/explicit rejection before a job id). Safe to try one other
 * healthy worker.
 * `uncertain` — timeout or unreadable answer: the worker MAY have started a
 * portal session. Never retried here; it goes to the existing ambiguous/manual
 * reconciliation path.
 */
export function classifyDispatchFailure(msg: string | null | undefined): "pre_accept" | "uncertain" {
  const t = String(msg ?? "");
  if (/timed out|timeout|abort|socket hang up|ECONNRESET/i.test(t)) return "uncertain";
  if (
    /ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|fetch failed|network|Failed to fetch/i.test(t) ||
    /rejected the request \((?:5\d\d|429)\)/i.test(t)
  ) {
    return "pre_accept";
  }
  return "uncertain";
}

/**
 * Send one prepared payload to the fleet.
 *
 * At most ONE failover, and only when the first attempt provably failed before
 * the worker accepted anything.
 */
export type FleetContext = { fleet: FleetWorker[]; load: WorkerLoad };

/** Load fleet + live per-worker load once per batch instead of once per job. */
export async function loadFleetContext(supabase: any): Promise<FleetContext> {
  const [fleet, load] = await Promise.all([loadFleet(supabase), loadWorkerActiveCounts(supabase)]);
  return { fleet, load };
}

export async function dispatchToFleet(
  supabase: any,
  args: {
    payload: any;
    jobId: string;
    companyId: string | null | undefined;
    /** Reuse a batch-level snapshot; omitted = load it for this call. */
    context?: FleetContext | null;
  },
): Promise<FleetDispatchResult> {
  const { postSubmitClaimTo } = await import("@/lib/robotAdapter.server");

  if (isFleetDisabled()) {
    throw new Error("Submission robots are disabled by the fleet kill switch. Nothing was sent.");
  }

  const { fleet, load } = args.context ?? (await loadFleetContext(supabase));
  const primary =
    pickWorkerForCompany(fleet, args.companyId, load) ??
    // Every healthy worker is at capacity: the queue's own caps normally
    // prevent this, so prefer sending over dropping the lease on the floor.
    pickWorkerForCompany(fleet, args.companyId, load, { ignoreCapacity: true });

  if (!primary) {
    throw new Error(
      "No healthy submission robot is available right now — the bill stays queued and will retry.",
    );
  }

  try {
    load.set(primary.id, (load.get(primary.id) ?? 0) + 1);
    const jobId = await postSubmitClaimTo(args.payload, args.jobId, primary);
    await recordWorkerHealth(supabase, primary, true);
    return { jobId, workerId: primary.id, workerUrl: primary.url, failedOverFrom: null };
  } catch (e: any) {
    const msg = e?.message ?? "Automation service call failed";
    load.set(primary.id, Math.max(0, (load.get(primary.id) ?? 1) - 1));
    const kind = classifyDispatchFailure(msg);
    await recordWorkerHealth(supabase, primary, false, msg);
    if (kind !== "pre_accept") throw e;

    const backup = pickWorkerForCompany(fleet, args.companyId, load, {
      exclude: [primary.id],
      ignoreCapacity: true,
    });
    if (!backup) throw e;

    load.set(backup.id, (load.get(backup.id) ?? 0) + 1);
    const jobId = await postSubmitClaimTo(args.payload, args.jobId, backup);
    await recordWorkerHealth(supabase, backup, true);
    return { jobId, workerId: backup.id, workerUrl: backup.url, failedOverFrom: primary.id };
  }
}

/** Base URL to poll for a job — ALWAYS the worker that accepted it. */
export function pollBaseUrlFor(trip: { robot_worker_url?: string | null } | null | undefined): string {
  const u = trip?.robot_worker_url ? normalizeUrl(String(trip.robot_worker_url)) : "";
  return /^https?:\/\//i.test(u) ? u : ROBOT_BASE_URL;
}
