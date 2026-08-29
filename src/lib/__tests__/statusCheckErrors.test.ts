import { describe, expect, it } from "vitest";
import {
  classifyStatusCheckFailure,
  describeStatusCheckFailure,
  INFRA_RETRY_MS,
} from "@/lib/statusCheckErrors";

describe("status-check failure classification", () => {
  it("treats checker-service outages as infrastructure, not a portal answer", () => {
    const eagain =
      "checker job error: browserType.launch: Failed to launch: Error: spawn /ms-playwright/chromium-1134/chrome-linux/chrome EAGAIN";
    expect(classifyStatusCheckFailure(eagain)).toBe("infra");
    expect(classifyStatusCheckFailure("checker unreachable: fetch failed")).toBe("infra");
    expect(classifyStatusCheckFailure("checker job timed out")).toBe("infra");
    expect(classifyStatusCheckFailure("checker HTTP 503: upstream")).toBe("infra");
  });

  it("treats an unrecognised portal answer as a portal outcome", () => {
    expect(classifyStatusCheckFailure("portal returned NO_RESULTS")).toBe("portal");
    expect(classifyStatusCheckFailure("portal status not recognised")).toBe("portal");
  });

  it("never shows a raw stack trace to the user", () => {
    const msg = describeStatusCheckFailure("browserType.launch: Failed to launch\n  at foo.js:1");
    expect(msg).not.toMatch(/browserType|at foo\.js/);
    expect(msg).toMatch(/temporarily unavailable/i);
  });

  it("uses a short flat retry for infrastructure failures", () => {
    expect(INFRA_RETRY_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});
