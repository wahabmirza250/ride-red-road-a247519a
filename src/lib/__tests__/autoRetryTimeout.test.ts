import { describe, it, expect, vi, beforeEach } from "vitest";

const audits: any[] = [];
vi.mock("@/lib/billingHelpers", async () => {
  const actual: any = await vi.importActual("@/lib/billingHelpers");
  return {
    ...actual,
    logAudit: vi.fn(async (_sb: any, id: string, _a: any, action: string, note?: string) => {
      audits.push({ id, action, note });
    }),
  };
});

import { maybeAutoRetryTimeout } from "@/lib/autoRetry.server";
import { looksLikeRetryableTimeout, MAX_AUTO_TIMEOUT_RETRIES } from "@/lib/billingHelpers";

function makeSupabase(record: any, trip: any) {
  return {
    from(table: string) {
      const state: any = {};
      const b: any = {
        select: () => b,
        update: (u: any) => {
          state.update = u;
          return b;
        },
        eq: () => b,
        maybeSingle: async () => ({ data: record, error: null }),
        then: (res: any) => {
          if (state.update) Object.assign(table === "billing_records" ? record : trip, state.update);
          return res({ data: [], error: null });
        },
      };
      return b;
    },
  } as any;
}

// Only a timeout that explicitly proves the run died before Submit is retryable.
const TIMEOUT_ERR =
  "stage=login: page.click: Timeout 480000ms exceeded — submit_reached=false, portal login never completed";
const GENERIC_TIMEOUT = "Job timed out after 480s";
const SUBMIT_TIMEOUT =
  "Timeout 480000ms exceeded after clicking Submit (SubmitClaimProf3) — click action done";
const DATA_ERR = "Still on Step 1 after clicking Continue. Errors: * Indicates a required field.";

describe("automatic timeout retry", () => {
  beforeEach(() => {
    audits.length = 0;
  });

  it("classifies timeouts as retryable only with explicit pre-submit evidence", () => {
    expect(looksLikeRetryableTimeout(TIMEOUT_ERR)).toBe(true);
    expect(looksLikeRetryableTimeout(GENERIC_TIMEOUT)).toBe(false);
    expect(looksLikeRetryableTimeout(SUBMIT_TIMEOUT)).toBe(false);
    expect(looksLikeRetryableTimeout(DATA_ERR)).toBe(false);
    expect(looksLikeRetryableTimeout("Medicaid ID not found for member")).toBe(false);
  });

  it("never auto-retries a generic worker timeout with no stage evidence", async () => {
    const record: any = { id: "b9", auto_retry_count: 0, status: "submitting" };
    const trip: any = { id: "t9", robot_job_id: "job9" };
    const sb = makeSupabase(record, trip);

    const out = await maybeAutoRetryTimeout(sb, "b9", "t9", GENERIC_TIMEOUT, "actor");
    expect(out).toEqual({ retried: false, exhausted: false, message: null });
    expect(record.status).toBe("submitting");
    expect(record.auto_retry_count).toBe(0);
    expect(trip.robot_job_id).toBe("job9"); // original job id preserved
    expect(audits.length).toBe(0);
  });

  it("never auto-retries a timeout that mentions the Submit/Confirm boundary", async () => {
    const record: any = { id: "b10", auto_retry_count: 0, status: "submitting" };
    const trip: any = { id: "t10", robot_job_id: "job10" };
    const sb = makeSupabase(record, trip);

    const out = await maybeAutoRetryTimeout(sb, "b10", "t10", SUBMIT_TIMEOUT, "actor");
    expect(out.retried).toBe(false);
    expect(record.auto_retry_count).toBe(0);
    expect(trip.robot_job_id).toBe("job10");
    expect(audits.length).toBe(0);
  });


  it("re-queues a timed-out bill up to the cap, then parks it for a human", async () => {
    const record: any = { id: "b1", auto_retry_count: 0, status: "submitting" };
    const trip: any = { id: "t1", robot_job_id: "job1" };
    const sb = makeSupabase(record, trip);

    for (let i = 1; i <= MAX_AUTO_TIMEOUT_RETRIES; i++) {
      const out = await maybeAutoRetryTimeout(sb, "b1", "t1", TIMEOUT_ERR, "actor");
      expect(out.retried).toBe(true);
      expect(record.status).toBe("queued"); // normal queue → same pacing rules
      expect(record.auto_retry_count).toBe(i);
      expect(trip.robot_job_id).toBe(null);
      expect(audits.at(-1).action).toBe("auto_retry_timeout");
    }

    const last = await maybeAutoRetryTimeout(sb, "b1", "t1", TIMEOUT_ERR, "actor");
    expect(last.retried).toBe(false);
    expect(record.status).toBe("needs_fix");
    expect(record.submission_error).toContain(
      `Timed out ${MAX_AUTO_TIMEOUT_RETRIES + 1} times — may need manual review`,
    );
    expect(audits.at(-1).action).toBe("auto_retry_exhausted");
  });

  it("never auto-retries a data-validation failure", async () => {
    const record: any = { id: "b2", auto_retry_count: 0, status: "submitting" };
    const trip: any = { id: "t2", robot_job_id: "job2" };
    const sb = makeSupabase(record, trip);

    const out = await maybeAutoRetryTimeout(sb, "b2", "t2", DATA_ERR, "actor");
    expect(out).toEqual({ retried: false, exhausted: false, message: null });
    expect(record.status).toBe("submitting"); // untouched — reconciler marks needs_fix
    expect(record.auto_retry_count).toBe(0);
    expect(audits.length).toBe(0);
  });

  it("does not downgrade or resubmit when success was already recorded before a timeout arrives", async () => {
    const record: any = {
      id: "b3",
      auto_retry_count: 0,
      status: "submitted",
      state_confirmation_number: "2326237001236",
      medicaid_trips: {
        robot_confirmation_number: "2326237001236",
        submitted_confirmation: "2326237001236",
        robot_last_status: "SUBMITTED",
      },
    };
    const trip: any = { id: "t3", robot_job_id: "job3", robot_last_status: "SUBMITTED" };
    const sb = makeSupabase(record, trip);

    const out = await maybeAutoRetryTimeout(sb, "b3", "t3", TIMEOUT_ERR, "actor");
    expect(out.retried).toBe(false);
    expect(record.status).toBe("submitted");
    expect(record.auto_retry_count).toBe(0);
    expect(trip.robot_job_id).toBe("job3");
    expect(audits.at(-1).action).toBe("auto_retry_skipped_claim_evidence");
  });
});
