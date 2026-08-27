import { beforeEach, describe, expect, it, vi } from "vitest";

const audit: Array<{ action: string; notes: string }> = [];
vi.mock("@/lib/billingHelpers", () => ({
  logAudit: async (_s: unknown, _id: string, _a: unknown, action: string, notes: string) => {
    audit.push({ action, notes });
  },
}));

import {
  recordVerifiedClaimFound,
  recordVerifiedNoClaim,
} from "@/lib/manualVerification.server";
import { VERIFIED_NOT_SUBMITTED_STATUS } from "@/lib/needsVerification";

type Row = Record<string, any>;

function fakeSupabase(record: Row) {
  const updates: Record<string, Row[]> = { billing_records: [], medicaid_trips: [] };
  const api = {
    updates,
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: record, error: null }),
          }),
        }),
        update: (patch: Row) => ({
          eq: async () => {
            updates[table]?.push(patch);
            return { error: null };
          },
        }),
      };
    },
  };
  return api as any;
}

const baseRecord = () => ({
  id: "rec-1",
  status: "needs_fix",
  trip_id: "trip-1",
  requires_human_step: true,
  submission_error: "This submission never reported a final result.",
  submit_last_error: null,
  failure_code: "inflight_ceiling_unverified",
  state_confirmation_number: null,
  submit_account_key: "acct:hfc-colorado",
  medicaid_trips: {
    id: "trip-1",
    pickup_at: "2026-07-30T15:00:00.000Z",
    robot_job_id: "job-123",
    robot_last_status: "JOB_NOT_FOUND",
    robot_confirmation_number: null,
    submitted_confirmation: null,
    riders: { full_name: "Jane Doe", medicaid_id: "D260223" },
  },
});

beforeEach(() => {
  audit.length = 0;
});

describe("claim found in HCPF", () => {
  it("requires acknowledgement", async () => {
    await expect(
      recordVerifiedClaimFound(fakeSupabase(baseRecord()), {
        recordId: "rec-1",
        actorId: "u1",
        claimNumber: "2026999",
        acknowledged: false,
      }),
    ).rejects.toThrow(/searched the HCPF portal/i);
  });

  it("marks the existing bill submitted with the entered claim id and audits it", async () => {
    const sb = fakeSupabase(baseRecord());
    const res = await recordVerifiedClaimFound(sb, {
      recordId: "rec-1",
      actorId: "u1",
      claimNumber: " 2026999 ",
      acknowledged: true,
    });
    expect(res).toMatchObject({ ok: true, status: "submitted", claim: "2026999" });
    expect(sb.updates.billing_records[0]).toMatchObject({
      status: "submitted",
      state_confirmation_number: "2026999",
      requires_human_step: false,
    });
    expect(sb.updates.medicaid_trips[0]).toMatchObject({
      robot_confirmation_number: "2026999",
      submitted_confirmation: "2026999",
    });
    expect(audit[0].action).toBe("manual_verification_claim_found");
    // Original job / account context preserved in the audit line.
    expect(audit[0].notes).toMatch(/job-123/);
    expect(audit[0].notes).toMatch(/acct:hfc-colorado/);
    // Job id and idempotency fields are never cleared.
    expect(sb.updates.medicaid_trips[0]).not.toHaveProperty("robot_job_id");
  });

  it("refuses when a claim number already exists", async () => {
    const rec = baseRecord();
    rec.medicaid_trips.robot_confirmation_number = "111";
    await expect(
      recordVerifiedClaimFound(fakeSupabase(rec), {
        recordId: "rec-1",
        actorId: "u1",
        claimNumber: "222",
        acknowledged: true,
      }),
    ).rejects.toThrow(/already has a portal claim number/i);
  });
});

describe("no claim found in HCPF", () => {
  it("requires the explicit manual-check acknowledgement", async () => {
    await expect(
      recordVerifiedNoClaim(fakeSupabase(baseRecord()), {
        recordId: "rec-1",
        actorId: "u1",
        acknowledged: false,
      }),
    ).rejects.toThrow(/manually searched HCPF/i);
  });

  it("moves the bill to Ready to Submit without enqueueing or submitting", async () => {
    const sb = fakeSupabase(baseRecord());
    const res = await recordVerifiedNoClaim(sb, {
      recordId: "rec-1",
      actorId: "u1",
      acknowledged: true,
    });
    expect(res).toMatchObject({ ok: true, status: "approved" });
    const bill = sb.updates.billing_records[0];
    expect(bill).toMatchObject({ status: "approved", requires_human_step: false });
    expect(bill.status).not.toBe("queued");
    expect(sb.updates.medicaid_trips[0].robot_last_status).toBe(VERIFIED_NOT_SUBMITTED_STATUS);
    expect(audit[0].action).toBe("manual_verification_no_claim");
    expect(audit[0].notes).toMatch(/job-123/);
  });

  it("refuses on a bill that is not a verification case", async () => {
    const rec = baseRecord();
    rec.requires_human_step = false;
    rec.failure_code = "worker_capacity";
    rec.submission_error = "browserType.launch: spawn EAGAIN";
    rec.medicaid_trips.robot_last_status = "error";
    await expect(
      recordVerifiedNoClaim(fakeSupabase(rec), {
        recordId: "rec-1",
        actorId: "u1",
        acknowledged: true,
      }),
    ).rejects.toThrow(/not awaiting manual HCPF verification/i);
  });
});
