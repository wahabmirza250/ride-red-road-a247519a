/**
 * ROBOT WORKER HEALTH AS PRESENTED TO OPS (pure — safe on the client).
 *
 * A worker row that was probed successfully days ago proves nothing about right
 * now. The runtime portal checker can be down, restarted or wedged in a browser
 * error loop while the registry row still says `enabled`, and showing that as a
 * green "healthy" robot is how an outage stays invisible.
 *
 * So the DISPLAYED health is derived from a RECENT successful answer:
 *   healthy   - answered successfully within the freshness window;
 *   degraded  - enabled, but the last good answer is stale, or errors are
 *               piling up (browser/session failures);
 *   unhealthy - disabled, in cooldown, or never answered at all.
 *
 * Dispatch eligibility is intentionally NOT changed here: this module only
 * decides what ops is told, so a probing gap can never silently stop billing.
 */

/** A successful probe older than this is no longer proof of life. */
export const WORKER_HEALTH_FRESH_MS = 10 * 60 * 1000;
/** Consecutive failures that make a still-enabled worker look degraded. */
export const WORKER_DEGRADED_FAILURE_STREAK = 2;

export type WorkerHealthInput = {
  enabled?: boolean | null;
  last_health_ok_at?: string | null;
  last_health_error?: string | null;
  failure_streak?: number | null;
  unhealthy_until?: string | null;
};

export type WorkerHealthState = "healthy" | "degraded" | "unhealthy";

export type WorkerHealth = {
  state: WorkerHealthState;
  /** Convenience for existing call sites that expect a boolean. */
  healthy: boolean;
  /** The last good answer is missing or older than the freshness window. */
  stale: boolean;
  /** Age of the last successful answer, ms — null when there never was one. */
  ageMs: number | null;
  /** One plain sentence for the ops panel. */
  reason: string;
};

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function humanAge(ageMs: number): string {
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return "less than a minute ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function workerHealth(
  w: WorkerHealthInput,
  now: number = Date.now(),
  freshMs: number = WORKER_HEALTH_FRESH_MS,
): WorkerHealth {
  const okAt = ms(w.last_health_ok_at);
  const ageMs = okAt === null ? null : Math.max(0, now - okAt);
  const stale = ageMs === null || ageMs > freshMs;
  const streak = Number(w.failure_streak ?? 0);

  if (w.enabled === false)
    return { state: "unhealthy", healthy: false, stale, ageMs, reason: "Turned off by an operator." };

  const cooldownUntil = ms(w.unhealthy_until);
  if (cooldownUntil !== null && cooldownUntil > now)
    return {
      state: "unhealthy",
      healthy: false,
      stale,
      ageMs,
      reason: w.last_health_error
        ? `Cooling down after an error: ${String(w.last_health_error).slice(0, 160)}`
        : "Cooling down after a failed check.",
    };

  if (ageMs === null)
    return {
      state: "unhealthy",
      healthy: false,
      stale: true,
      ageMs: null,
      reason: "Has never answered a health check.",
    };

  if (stale)
    return {
      state: "degraded",
      healthy: false,
      stale: true,
      ageMs,
      reason: `Last answered ${humanAge(ageMs)} — too long ago to count as running.`,
    };

  if (streak >= WORKER_DEGRADED_FAILURE_STREAK)
    return {
      state: "degraded",
      healthy: false,
      stale: false,
      ageMs,
      reason: `${streak} failed checks in a row${
        w.last_health_error ? `: ${String(w.last_health_error).slice(0, 160)}` : "."
      }`,
    };

  return {
    state: "healthy",
    healthy: true,
    stale: false,
    ageMs,
    reason: `Answered ${humanAge(ageMs)}.`,
  };
}

export const WORKER_HEALTH_LABEL: Record<WorkerHealthState, string> = {
  healthy: "Running",
  degraded: "Not answering",
  unhealthy: "Down",
};
