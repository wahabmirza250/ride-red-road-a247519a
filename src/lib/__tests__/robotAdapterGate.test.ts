import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isSubmissionTestMode,
  postSubmitClaim,
  setMockRobotPlan,
} from "@/lib/robotAdapter.server";

const origFetch = globalThis.fetch;

beforeEach(() => {
  process.env["SUBMISSION_TEST_MODE"] = "1";
  setMockRobotPlan(null);
});
afterEach(() => {
  delete process.env["SUBMISSION_TEST_MODE"];
  globalThis.fetch = origFetch;
});

describe("hard no-network test gate", () => {
  it("recognises the flag", () => {
    expect(isSubmissionTestMode()).toBe(true);
    process.env["SUBMISSION_TEST_MODE"] = "0";
    expect(isSubmissionTestMode()).toBe(false);
    delete process.env["SUBMISSION_TEST_MODE"];
    expect(isSubmissionTestMode()).toBe(false);
  });

  it("never calls fetch while test mode is on", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = spy as any;
    const id = await postSubmitClaim({ any: "payload" }, "job-1");
    expect(id).toBe("mock-job-1");
    expect(spy).not.toHaveBeenCalled();
  });

  it("produces every planned outcome deterministically, offline", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as any;
    setMockRobotPlan(() => "transient_timeout");
    await expect(postSubmitClaim({}, "j")).rejects.toThrow(/timed out/i);
    setMockRobotPlan(() => "validation_failure");
    await expect(postSubmitClaim({}, "j")).rejects.toThrow(/required field/i);
    setMockRobotPlan(() => "ambiguous");
    await expect(postSubmitClaim({}, "j")).rejects.toThrow(/Confirm/i);
    setMockRobotPlan(() => "slow_success");
    await expect(postSubmitClaim({}, "j")).resolves.toBe("mock-j");
    expect(spy).not.toHaveBeenCalled();
  });
});
