import { describe, expect, it } from "vitest";
import { checkOneClaim, isFinalCheckerJobState } from "@/lib/claimStatusSync.server";
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

describe("checkOneClaim polling flow (production stall)", () => {
  const fakeFetch = (script: Array<{ status: number; body: unknown }>) => {
    let i = 0;
    return (async () => {
      const step = script[Math.min(i++, script.length - 1)]!;
      return new Response(JSON.stringify(step.body), { status: step.status });
    }) as unknown as typeof fetch;
  };

  it("queued -> running -> done is processed, never fails early", async () => {
    const out = await checkOneClaim(
      "co-1",
      "CLM123",
      fakeFetch([
        { status: 200, body: { jobId: "j1" } },
        { status: 200, body: { status: "queued" } },
        { status: 200, body: { status: "queued" } },
        { status: 200, body: { status: "running" } },
        {
          status: 200,
          body: { status: "done", result: { result_state: "RESULTS_FOUND", detected_status: "Paid" } },
        },
      ]),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.row.status).toBe("paid");
  }, 30_000);

  it("queued followed by an eventual done is processed", async () => {
    const out = await checkOneClaim(
      "co-1",
      "CLM999",
      fakeFetch([
        { status: 200, body: { jobId: "j2" } },
        { status: 200, body: { status: "queued" } },
        {
          status: 200,
          body: {
            status: "done",
            result: { result_state: "RESULTS_FOUND", detected_status: "Denied" },
          },
        },
      ]),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.row.status).toBe("denied");
  }, 30_000);

  it("a genuinely failed job still reports its real cause", async () => {
    const out = await checkOneClaim(
      "co-1",
      "CLM1",
      fakeFetch([
        { status: 200, body: { jobId: "j3" } },
        { status: 200, body: { status: "queued" } },
        { status: 200, body: { status: "failed", error: "browser crashed" } },
      ]),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toContain("browser crashed");
  }, 30_000);
});
