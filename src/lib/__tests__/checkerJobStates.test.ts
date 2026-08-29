import { describe, expect, it } from "vitest";
import { isFinalCheckerJobState } from "@/lib/claimStatusSync.server";
import { classifyStatusCheckFailure } from "@/lib/statusCheckErrors";

describe("checker job state handling (production stall)", () => {
  it("treats 'queued' as still-working, never as a finished job", () => {
    expect(isFinalCheckerJobState("queued")).toBe(false);
    expect(isFinalCheckerJobState("waiting")).toBe(false);
    expect(isFinalCheckerJobState("running")).toBe(false);
    expect(isFinalCheckerJobState("processing")).toBe(false);
    expect(isFinalCheckerJobState("")).toBe(false);
    expect(isFinalCheckerJobState("some_state_we_have_never_seen")).toBe(false);
  });

  it("recognises real finished states", () => {
    for (const s of ["done", "completed", "success", "error", "failed", "timeout"]) {
      expect(isFinalCheckerJobState(s)).toBe(true);
    }
  });

  it("classifies checker-service job failures as infra (no attempt burned, fast requeue)", () => {
    expect(classifyStatusCheckFailure("checker job queued: no detail")).toBe("infra");
    expect(classifyStatusCheckFailure("checker job error: ")).toBe("infra");
    expect(classifyStatusCheckFailure("checker job failed: browser crashed")).toBe("infra");
  });

  it("still treats a real portal answer as a portal outcome", () => {
    expect(classifyStatusCheckFailure("portal returned NO_RESULTS")).toBe("portal");
    expect(classifyStatusCheckFailure("portal status not recognised")).toBe("portal");
  });
});
