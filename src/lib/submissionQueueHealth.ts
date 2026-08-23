/**
 * Pure, UI-facing derivation of the submission-queue health summary.
 *
 * Everything here is a read-only projection of `getSubmissionQueueState` —
 * it never triggers work, never touches the portal, and contains no secrets.
 */
import type { SubmissionQueueState } from "@/lib/submissionQueue.functions";

export type QueueHealthLevel = "paused" | "warning" | "healthy";

export type QueueTotals = {
  queued: number;
  processing: number;
  retrying: number;
  needsAttention: number;
  submittedLastHour: number;
  leased: number;
  staleLocks: number;
  oldestQueuedAt: string | null;
  avgSubmitMs: number | null;
  lastSubmittedAt: string | null;
};

export const SCHEDULER_STALE_MS = 10 * 60_000;
export const BACKLOG_WARN = 50;
export const OLDEST_WARN_MS = 30 * 60_000;

export function totalsFromState(state: SubmissionQueueState | undefined): QueueTotals {
  const rows = state?.metrics ?? [];
  const sum = (k: "queued" | "processing" | "retrying" | "needs_attention" | "submitted_last_hour" | "leased" | "stale_locks") =>
    rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);

  const oldest = rows
    .map((r) => r.oldest_queued_at)
    .filter((v): v is string => Boolean(v))
    .sort()[0] ?? null;

  const lastSubmitted = rows
    .map((r) => r.last_submitted_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null;

  const durations = rows
    .map((r) => (r.avg_submit_ms == null ? null : Number(r.avg_submit_ms)))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

  return {
    queued: sum("queued"),
    processing: sum("processing"),
    retrying: sum("retrying"),
    needsAttention: sum("needs_attention"),
    submittedLastHour: sum("submitted_last_hour"),
    leased: sum("leased"),
    staleLocks: sum("stale_locks"),
    oldestQueuedAt: oldest,
    avgSubmitMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    lastSubmittedAt: lastSubmitted,
  };
}

/**
 * Health is intentionally conservative: anything that could silently stall
 * submissions (dead scheduler, abandoned lease, ageing backlog) is a warning,
 * never a green light.
 */
export function deriveQueueHealth(
  state: SubmissionQueueState | undefined,
  now: number = Date.now(),
): { level: QueueHealthLevel; label: string; issues: string[] } {
  if (!state) return { level: "warning", label: "Unknown", issues: ["Status not loaded yet"] };

  const t = totalsFromState(state);
  const issues: string[] = [...(state.health?.issues ?? [])];

  const lastRun = state.last_run_at ? new Date(state.last_run_at).getTime() : 0;
  const hasWork = t.queued + t.retrying + t.processing > 0;
  if (!lastRun) {
    issues.push("Scheduler has not reported a run yet");
  } else if (hasWork && now - lastRun > SCHEDULER_STALE_MS) {
    issues.push("Scheduler has not run in the last 10 minutes while work is waiting");
  }
  if (t.staleLocks > 0) issues.push(`${t.staleLocks} abandoned worker lease(s) awaiting release`);
  if (t.queued >= BACKLOG_WARN) issues.push(`Large backlog: ${t.queued} bills queued`);
  if (t.oldestQueuedAt && now - new Date(t.oldestQueuedAt).getTime() > OLDEST_WARN_MS) {
    issues.push("Oldest queued bill has been waiting over 30 minutes");
  }
  if (t.needsAttention > 0) issues.push(`${t.needsAttention} bill(s) need attention`);

  const unique = Array.from(new Set(issues));
  if (state.paused) return { level: "paused", label: "Submissions paused", issues: unique };
  if (unique.length) return { level: "warning", label: "Needs a look", issues: unique };
  return { level: "healthy", label: "Healthy", issues: [] };
}

/** "4m ago" style age label for the oldest queued bill. */
export function ageLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function durationLabel(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
