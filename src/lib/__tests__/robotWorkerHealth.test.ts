/**
 * A robot that answered hours ago is not "healthy" — showing it green is how
 * an outage stays invisible while claims silently stop moving.
 */
import { describe, expect, it } from "vitest";
import {
  WORKER_HEALTH_FRESH_MS,
  workerHealth,
} from "@/lib/robotWorkerHealth";

const now = new Date("2026-09-01T12:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

describe("displayed robot worker health", () => {
  it("is healthy only with a recent successful answer", () => {
    const h = workerHealth({ enabled: true, last_health_ok_at: minutesAgo(2), failure_streak: 0 }, now);
    expect(h.state).toBe("healthy");
    expect(h.healthy).toBe(true);
    expect(h.stale).toBe(false);
  });

  it("STALE HEALTH: an old success is never shown as healthy", () => {
    const h = workerHealth({ enabled: true, last_health_ok_at: minutesAgo(90), failure_streak: 0 }, now);
    expect(h.state).toBe("degraded");
    expect(h.healthy).toBe(false);
    expect(h.stale).toBe(true);
    expect(h.reason).toMatch(/too long ago/i);
  });

  it("a worker that never answered is down, not healthy", () => {
    const h = workerHealth({ enabled: true, last_health_ok_at: null }, now);
    expect(h.state).toBe("unhealthy");
    expect(h.reason).toMatch(/never answered/i);
  });

  it("repeated browser errors degrade a still-fresh worker", () => {
    const h = workerHealth(
      {
        enabled: true,
        last_health_ok_at: minutesAgo(1),
        failure_streak: 3,
        last_health_error: "Target page, context or browser has been closed",
      },
      now,
    );
    expect(h.state).toBe("degraded");
    expect(h.reason).toMatch(/failed checks in a row/i);
  });

  it("cooldown and operator switch-off are down, whatever the timestamps say", () => {
    expect(
      workerHealth(
        { enabled: true, last_health_ok_at: minutesAgo(1), unhealthy_until: minutesAgo(-5) },
        now,
      ).state,
    ).toBe("unhealthy");
    expect(workerHealth({ enabled: false, last_health_ok_at: minutesAgo(1) }, now).state).toBe(
      "unhealthy",
    );
  });

  it("the freshness window is exactly the documented one", () => {
    const edge = new Date(now - WORKER_HEALTH_FRESH_MS + 1000).toISOString();
    expect(workerHealth({ enabled: true, last_health_ok_at: edge }, now).state).toBe("healthy");
    const past = new Date(now - WORKER_HEALTH_FRESH_MS - 1000).toISOString();
    expect(workerHealth({ enabled: true, last_health_ok_at: past }, now).state).toBe("degraded");
  });
});
