/**
 * ROBOT ADAPTER — the single network boundary to the HCPF submission robot.
 *
 * Every real portal submission in the app funnels through `postSubmitClaim`.
 * That gives us one place to enforce a HARD, server-side test gate: when
 * `SUBMISSION_TEST_MODE` is enabled, no `fetch` to the automation service can
 * happen at all — the adapter answers from a deterministic in-process mock.
 *
 * The production path is byte-for-byte unchanged when the flag is off, and the
 * robot repo itself is never touched.
 */

/** Truthy values that enable the non-network test/benchmark mode. */
export function isSubmissionTestMode(): boolean {
  const raw = String(process.env["SUBMISSION_TEST_MODE"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export type MockOutcome =
  | "fast_success"
  | "slow_success"
  | "transient_timeout"
  | "validation_failure"
  | "ambiguous"
  /** Provable pre-accept failure — the worker never took the job. */
  | "worker_down";

/** Deterministic outcome plan used by the load harness (test mode only). */
let mockPlan: ((jobId: string, payload: any) => MockOutcome) | null = null;
let mockCalls = 0;
let realCallAttempts = 0;

export function setMockRobotPlan(fn: ((jobId: string, payload: any) => MockOutcome) | null) {
  mockPlan = fn;
  mockCalls = 0;
}
export function mockRobotStats() {
  return { calls: mockCalls, realCallAttempts };
}

/**
 * Start a submission job on a SPECIFIC worker. In test mode this NEVER touches
 * the network. Returns the job id the caller must persist together with the
 * worker id — reconciliation has to poll the same worker.
 */
export async function postSubmitClaimTo(
  payload: any,
  jobId: string,
  worker: { id: string; url: string },
): Promise<string> {
  if (isSubmissionTestMode()) {
    mockCalls++;
    const outcome = mockPlan ? mockPlan(jobId, { ...payload, __worker: worker.id }) : "fast_success";
    switch (outcome) {
      case "slow_success":
        await new Promise((r) => setTimeout(r, 5));
        return `mock-${jobId}`;
      case "transient_timeout":
        throw new Error("Robot timed out after 600s (mock)");
      case "validation_failure":
        throw new Error("Indicates a required field. (mock)");
      case "ambiguous":
        throw new Error("Confirm was clicked but the page timed out (mock)");
      case "worker_down":
        throw new Error("fetch failed: connect ECONNREFUSED (mock worker down)");
      default:
        return `mock-${jobId}`;
    }
  }

  realCallAttempts++;
  const res = await fetch(`${worker.url}/submit-claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Automation service rejected the request (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* tolerate non-JSON */
  }
  return typeof parsed?.jobId === "string" && parsed.jobId ? parsed.jobId : jobId;
}

/**
 * Legacy single-service entry point. Kept so any caller that predates the
 * fleet keeps working against the original `ROBOT_BASE_URL`.
 */
export async function postSubmitClaim(payload: any, jobId: string): Promise<string> {
  if (isSubmissionTestMode()) return await postSubmitClaimTo(payload, jobId, { id: "mock", url: "" });
  const { ROBOT_BASE_URL } = await import("@/lib/robotConfig");
  return await postSubmitClaimTo(payload, jobId, { id: "legacy", url: ROBOT_BASE_URL });
}

