/**
 * Reconciliation of bills parked behind a STALE pre-submit worker failure,
 * and the live-linkage guard that stops a claim being finalized twice.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isStaleWorkerFailure,
  mayReconcileWithProof,
  STALE_WORKER_CLEARED_FIELDS,
} from "@/lib/staleWorkerReconcile";
import {
  applyLiveLinks,
  candidateClaimIds,
  CLAIM_ALREADY_LINKED_LABEL,
} from "@/lib/reconcileSweep";
import { decideAutoFinalize } from "@/lib/sweepAutoFinalize";

const workerParked = {
  status: "needs_fix",
  requires_human_step: true,
  failure_code: "worker_unavailable",
  submission_error: "The worker stopped before the automation service could send this bill.",
  state_confirmation_number: null,
};

describe("stale worker flag", () => {
  it("recognises a pre-submit worker failure with no claim evidence", () => {
    expect(isStaleWorkerFailure(workerParked)).toBe(true);
  });

  it("is never stale once the bill already owns a claim number", () => {
    expect(isStaleWorkerFailure({ ...workerParked, state_confirmation_number: "2326241001170" })).toBe(
      false,
    );
  });

  it("never overrides a genuine manual-verification case", () => {
    expect(
      isStaleWorkerFailure({
        status: "needs_fix",
        requires_human_step: true,
        failure_code: "ambiguous_outcome",
        robot_last_status: "SUBMITTED_UNVERIFIED",
      }),
    ).toBe(false);
  });

  it("is only cleared WITH a matching portal proof, never on its own", () => {
    expect(mayReconcileWithProof(workerParked, null, "2326241001170")).toBe(false);
    expect(
      mayReconcileWithProof(
        workerParked,
        { source: "sweep_single_match", claim_id: "2326241001170" },
        "2326241001170",
      ),
    ).toBe(true);
  });

  it("refuses a proof for a different claim id", () => {
    expect(
      mayReconcileWithProof(
        workerParked,
        { source: "sweep_single_match", claim_id: "2326241001103" },
        "2326241001170",
      ),
    ).toBe(false);
  });

  it("clears only the stale failure bookkeeping fields", () => {
    expect(STALE_WORKER_CLEARED_FIELDS).toEqual({
      requires_human_step: false,
      failure_code: null,
      failure_stage: null,
      submission_error: null,
      submit_last_error: null,
    });
  });
});

describe("live linkage beats the search-time snapshot", () => {
  const row = {
    id: "r1",
    billing_record_id: "b1",
    company_id: "c1",
    member_id: "P1",
    service_date: "07/30/2026",
    outcome: "single",
    candidates: [
      { claim_id: "2326241001170", status: "Paid", paid_amount: 10, linked: null } as any,
    ],
  };

  it("marks a candidate linked when another bill claimed it after the search", () => {
    const [live] = applyLiveLinks([row], new Map([["2326241001170", { billing_record_id: "other" }]]));
    expect(live!.candidates[0]!.linked).toEqual({ billing_record_id: "other" });
    expect(decideAutoFinalize(live as any).ok).toBe(false);
  });

  it("a stale 'linked' snapshot cannot survive a live re-check that frees it", () => {
    const stale = {
      ...row,
      candidates: [{ ...row.candidates[0], linked: { billing_record_id: "gone" } }],
    };
    const [live] = applyLiveLinks([stale], new Map());
    expect(live!.candidates[0]!.linked).toBeNull();
    expect(decideAutoFinalize(live as any).ok).toBe(true);
  });

  it("a claim linked to the row's OWN bill is not a conflict", () => {
    const [live] = applyLiveLinks([row], new Map([["2326241001170", { billing_record_id: "b1" }]]));
    expect(live!.candidates[0]!.linked).toBeNull();
  });

  it("collects every candidate claim id once", () => {
    expect(candidateClaimIds([row, row])).toEqual(["2326241001170"]);
  });

  it("shows the duplicate wording instead of an unused-claim offer", () => {
    expect(CLAIM_ALREADY_LINKED_LABEL).toBe("Claim already linked to another RedArt bill");
  });
});

describe("finalize a proven single match on a worker-parked bill", () => {
  function harness(rec: Record<string, unknown>) {
    const writes: any[] = [];
    const supabase: any = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "b1",
                  ...rec,
                  medicaid_trips: {
                    id: "t1",
                    pickup_at: "2026-07-30T15:00:00Z",
                    riders: { full_name: "A B", medicaid_id: "P1" },
                  },
                },
                error: null,
              }),
              maybeSingle: async () => ({ data: null }),
            }),
            in: async () => ({ data: [] }),
          }),
          update(patch: any) {
            writes.push({ table, patch });
            return { eq: async () => ({ error: null }) };
          },
          insert: async () => ({ error: null }),
        };
      },
    };
    return { supabase, writes };
  }

  it("attaches the claim and clears the stale worker flags in the same write", async () => {
    const { recordVerifiedClaimFound } = await import("@/lib/manualVerification.server");
    const { supabase, writes } = harness(workerParked);
    await recordVerifiedClaimFound(supabase, {
      recordId: "b1",
      actorId: "u1",
      claimNumber: "2326241001170",
      acknowledged: true,
      reconcileProof: { source: "sweep_single_match", claim_id: "2326241001170" },
    });
    const bill = writes.find((w) => w.table === "billing_records")!.patch;
    expect(bill.state_confirmation_number).toBe("2326241001170");
    expect(bill.requires_human_step).toBe(false);
    expect(bill.failure_code).toBeNull();
    expect(bill.failure_stage).toBeNull();
    expect(bill.submit_last_error).toBeNull();
    // No submission job, no attempt, nothing queued.
    expect(JSON.stringify(writes)).not.toMatch(/queued|submit_attempt|robot_job/);
  });

  it("still refuses a worker-parked bill WITHOUT portal proof", async () => {
    const { recordVerifiedClaimFound } = await import("@/lib/manualVerification.server");
    const { supabase } = harness(workerParked);
    await expect(
      recordVerifiedClaimFound(supabase, {
        recordId: "b1",
        actorId: "u1",
        claimNumber: "2326241001170",
        acknowledged: true,
      }),
    ).rejects.toThrow(/not awaiting manual HCPF verification/i);
  });

  it("refuses when the bill already carries a claim number (idempotency)", async () => {
    const { recordVerifiedClaimFound } = await import("@/lib/manualVerification.server");
    const { supabase } = harness({ ...workerParked, state_confirmation_number: "2326241001170" });
    await expect(
      recordVerifiedClaimFound(supabase, {
        recordId: "b1",
        actorId: "u1",
        claimNumber: "2326241001170",
        acknowledged: true,
        reconcileProof: { source: "sweep_single_match", claim_id: "2326241001170" },
      }),
    ).rejects.toThrow(/already has a portal claim number/i);
  });
});

describe("duplicate claim can never be finalized twice", () => {
  it("the attach writer refuses a claim owned by another bill", async () => {
    vi.resetModules();
    const { autoLinkSingleCandidate } = await import("@/lib/reconcileSweep.server");
    await expect(
      autoLinkSingleCandidate({} as any, {
        recordId: "b1",
        resultId: "r1",
        claim: { claim_id: "2326241001170", linked: { billing_record_id: "b2" } } as any,
      }),
    ).rejects.toThrow(/already linked/i);
  });
});
