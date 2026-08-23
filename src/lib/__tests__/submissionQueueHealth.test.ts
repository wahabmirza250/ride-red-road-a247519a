import { describe, expect, it } from "vitest";
import {
  ageLabel,
  deriveQueueHealth,
  durationLabel,
  totalsFromState,
} from "@/lib/submissionQueueHealth";
import type { SubmissionQueueState } from "@/lib/submissionQueue.functions";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

function state(over: Partial<SubmissionQueueState> = {}): SubmissionQueueState {
  return {
    paused: false,
    pause_reason: null,
    last_run_at: new Date(NOW - 30_000).toISOString(),
    last_result: {},
    limits: { per_company: 8, global: 20, lease_seconds: 300, max_attempts: 3, run_budget_ms: 100_000 },
    metrics: [],
    health: { ok: true, issues: [] },
    ...over,
  };
}

function row(over: Partial<SubmissionQueueState["metrics"][number]> = {}) {
  return {
    company_id: "c1",
    company_name: "Company One",
    queued: 0,
    retrying: 0,
    processing: 0,
    leased: 0,
    needs_attention: 0,
    submitted_last_hour: 0,
    stale_locks: 0,
    oldest_queued_at: null,
    avg_submit_ms: null,
    last_submitted_at: null,
    ...over,
  };
}

describe("submission queue health", () => {
  it("sums per-company metrics into totals", () => {
    const t = totalsFromState(
      state({
        metrics: [
          row({ queued: 3, processing: 2, needs_attention: 1, avg_submit_ms: 1000 }),
          row({ company_id: "c2", queued: 4, submitted_last_hour: 5, avg_submit_ms: 3000 }),
        ],
      }),
    );
    expect(t.queued).toBe(7);
    expect(t.processing).toBe(2);
    expect(t.needsAttention).toBe(1);
    expect(t.submittedLastHour).toBe(5);
    expect(t.avgSubmitMs).toBe(2000);
  });

  it("is healthy with a fresh scheduler and no issues", () => {
    expect(deriveQueueHealth(state({ metrics: [row({ queued: 2 })] }), NOW).level).toBe("healthy");
  });

  it("reports paused above every other signal", () => {
    const h = deriveQueueHealth(
      state({ paused: true, pause_reason: "Portal maintenance", metrics: [row({ stale_locks: 1 })] }),
      NOW,
    );
    expect(h.level).toBe("paused");
    expect(h.label).toBe("Submissions paused");
  });

  it("warns on stale locks, dead scheduler, backlog and needs-attention", () => {
    const h = deriveQueueHealth(
      state({
        last_run_at: new Date(NOW - 20 * 60_000).toISOString(),
        metrics: [
          row({
            queued: 80,
            stale_locks: 2,
            needs_attention: 3,
            oldest_queued_at: new Date(NOW - 90 * 60_000).toISOString(),
          }),
        ],
      }),
      NOW,
    );
    expect(h.level).toBe("warning");
    expect(h.issues.join(" | ")).toMatch(/Scheduler has not run/);
    expect(h.issues.join(" | ")).toMatch(/abandoned worker lease/);
    expect(h.issues.join(" | ")).toMatch(/Large backlog/);
    expect(h.issues.join(" | ")).toMatch(/waiting over 30 minutes/);
    expect(h.issues.join(" | ")).toMatch(/need attention/);
  });

  it("does not flag an idle scheduler when there is no work", () => {
    const h = deriveQueueHealth(
      state({ last_run_at: new Date(NOW - 60 * 60_000).toISOString(), metrics: [row()] }),
      NOW,
    );
    expect(h.level).toBe("healthy");
  });

  it("formats ages and durations", () => {
    expect(ageLabel(null, NOW)).toBe("—");
    expect(ageLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m");
    expect(ageLabel(new Date(NOW - 2 * 3600_000).toISOString(), NOW)).toBe("2h 0m");
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel(45_000)).toBe("45s");
    expect(durationLabel(125_000)).toBe("2m 5s");
  });
});
