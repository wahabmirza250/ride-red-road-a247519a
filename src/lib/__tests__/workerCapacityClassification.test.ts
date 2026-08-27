/**
 * INCIDENT GUARD: clear pre-submit infrastructure failures are CAPACITY, not
 * Needs Fix. Ambiguous / post-Submit / generic timeout cases must never be.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isBrowserLaunchFailure,
  isPreSubmitPacingCondition,
  classifySubmitFailure,
  sanitizeSubmitError,
  LAUNCH_BUSY_USER_MESSAGE,
} from "@/lib/submitErrors";
import { needsFixSummary } from "@/lib/needsFixCategory";

const CAPACITY = [
  "browserType.launch: Failed to launch: Error: spawn EAGAIN",
  "pthread_create: Resource temporarily unavailable (11)",
  "Failed to launch zygote process",
  "browserContext.newPage: Target closed",
  "browser.newContext: Target page, context or browser has been closed before any portal interaction",
];

const NOT_CAPACITY = [
  "Job timed out after 480s",
  "TimeoutError: page.click: Timeout 480000ms exceeded.",
  "Timeout 480000ms exceeded waiting for navigation after clicking Confirm (ConfirmCmnButton)",
  "SUBMITTED_UNVERIFIED — outcome unknown",
  "NEEDS_HUMAN_LOOKUP — a human must check the portal",
  "Still on Step 1 after clicking Continue. Errors: * Indicates a required field.",
  "Portal navigation after login timed out on the claims page",
  "JOB_NOT_FOUND — the automation service no longer knows about this job",
  "The worker stopped before the automation service confirmed this job.",
];

describe("pre-submit worker capacity classification", () => {
  it.each(CAPACITY)("treats %s as capacity, not a data fix", (msg) => {
    expect(isBrowserLaunchFailure(msg)).toBe(true);
    expect(isPreSubmitPacingCondition(msg)).toBe(true);
    expect(classifySubmitFailure(msg)).toEqual({ stage: "dispatch", code: "worker_capacity" });
    expect(sanitizeSubmitError(msg)).toBe(LAUNCH_BUSY_USER_MESSAGE);
    const s = needsFixSummary({ submission_error: msg });
    expect(s.category).toBe("capacity");
    expect(s.editable).toBe(false);
    expect(s.label).toMatch(/Robot capacity busy/i);
  });

  it.each(NOT_CAPACITY)("never treats %s as capacity", (msg) => {
    expect(isBrowserLaunchFailure(msg)).toBe(false);
    expect(isPreSubmitPacingCondition(msg)).toBe(false);
    expect(needsFixSummary({ submission_error: msg }).category).not.toBe("capacity");
  });
});

describe("fleet health vs browser capacity copy", () => {
  it("uses worker-unavailable copy only when no robot accepted the job", async () => {
    const { isFleetUnavailable, sanitizeSubmitError, INFRA_USER_MESSAGE, classifySubmitFailure } =
      await import("@/lib/submitErrors");
    const fleet = "No healthy submission robot is available right now — the bill stays queued and will retry.";
    expect(isFleetUnavailable(fleet)).toBe(true);
    expect(sanitizeSubmitError(fleet)).toBe(INFRA_USER_MESSAGE);
    expect(classifySubmitFailure(fleet)).toEqual({ stage: "dispatch", code: "worker_unavailable" });
    // Browser capacity must NOT borrow the fleet-health wording.
    expect(sanitizeSubmitError("browserType.launch: spawn EAGAIN")).not.toBe(INFRA_USER_MESSAGE);
    expect(isFleetUnavailable("browserType.launch: spawn EAGAIN")).toBe(false);
  });
});

describe("capacity requeue writer", () => {
  function fakeDb() {
    const updates: Record<string, any>[] = [];
    const supabase: any = {
      from: (table: string) => ({
        update: (patch: any) => {
          updates.push({ table, ...patch });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        insert: () => Promise.resolve({ data: null, error: null }),
      }),
    };
    return { supabase, updates };
  }

  it("requeues without burning an attempt or flagging a human", async () => {
    const { requeueForWorkerCapacity } = await import("@/lib/capacityRequeue.server");
    const { supabase, updates } = fakeDb();
    const out = await requeueForWorkerCapacity(supabase, {
      recordId: "rec-1",
      tripId: "trip-1",
      actorId: null,
      detail: "browserType.launch: spawn EAGAIN",
    });
    expect(out.message).toBe(LAUNCH_BUSY_USER_MESSAGE);
    const bill = updates.find((u) => u.table === "billing_records")!;
    expect(bill.status).toBe("queued");
    expect(bill.requires_human_step).toBe(false);
    expect(bill.failure_code).toBe("worker_capacity");
    expect(bill.submit_locked_until).toBeNull();
    expect(bill.submit_worker).toBeNull();
    expect("submit_attempt_count" in bill).toBe(false);
    expect("state_confirmation_number" in bill).toBe(false);
  });
});

vi.mock("@/lib/billingHelpers", async (orig) => {
  const actual: any = await orig();
  return { ...actual, logAudit: vi.fn(async () => {}) };
});
