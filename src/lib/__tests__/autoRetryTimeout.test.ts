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

const TIMEOUT_ERR = "page.click: Timeout 480000ms exceeded — the portal run timed out";
const DATA_ERR = "Still on Step 1 after clicking Continue. Errors: * Indicates a required field.";

describe("automatic timeout retry", () => {
  beforeEach(() => {
    audits.length = 0;
  });

  it("classifies timeouts as retryable and data errors as not", () => {
    expect(looksLikeRetryableTimeout(TIMEOUT_ERR)).toBe(true);
    expect(looksLikeRetryableTimeout(DATA_ERR)).toBe(false);
    expect(looksLikeRetryableTimeout("Medicaid ID not found for member")).toBe(false);
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
});
