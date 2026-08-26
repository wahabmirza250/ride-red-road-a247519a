import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const audits: any[] = [];
vi.mock("@/lib/billingHelpers", async () => {
  const actual: any = await vi.importActual("@/lib/billingHelpers");
  return {
    ...actual,
    logAudit: vi.fn(async (_sb: any, id: string, _a: any, action: string, notes?: string) => {
      audits.push({ id, action, notes });
    }),
    requireCompanyPortalCredential: vi.fn(async () => ({ portal_id: "hfc-colorado" })),
  };
});
vi.mock("@/lib/robotQueue.server", () => ({ resolveProviderUserId: vi.fn(async () => "prov") }));

import { resolveUnverifiedClaim } from "@/lib/unverifiedClaim.server";

const REC = {
  id: "rec1",
  status: "needs_fix",
  trip_id: "trip1",
  company_id: "co1",
  medicaid_trips: {
    id: "trip1",
    company_id: "co1",
    pickup_at: "2020-08-14T15:00:00Z",
    robot_last_checked_at: "2020-08-14T15:00:00Z",
    robot_confirmation_number: null,
    submitted_confirmation: null,
    riders: { medicaid_id: "O973706", full_name: "Test Rider" },
  },
};

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
        single: async () => ({ data: REC, error: null }),
        maybeSingle: async () => ({ data: REC, error: null }),
        then: (res: any) => {
          if (state.update)
            Object.assign(table === "billing_records" ? record : trip, state.update);
          return res({ data: [], error: null });
        },
      };
      return b;
    },
  } as any;
}

describe("read-only lookup with no search capability", () => {
  beforeEach(() => {
    audits.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never reports 'nothing found yet' when the search route does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Cannot POST /search-claims", { status: 404 })),
    );
    const record: any = { id: "rec1" };
    const trip: any = { id: "trip1" };

    const out = await resolveUnverifiedClaim(makeSupabase(record, trip), "rec1", "actor");

    expect(out.pending).toBe(false);
    expect(out.status).toBe("NEEDS_HUMAN_LOOKUP");
    expect(out.message).toMatch(/CANNOT VERIFY AUTOMATICALLY/);
    expect(out.message).toMatch(/Do NOT resubmit/);
    expect(out.message).not.toMatch(/found nothing yet/);
    // Search terms are handed to the human verbatim.
    expect(out.message).toMatch(/O973706/);
    expect(out.message).toMatch(/08\/14\/2020/);
    expect(out.confirmation_number ?? null).toBe(null);
  });

  it("still parks for a human when the service is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const out = await resolveUnverifiedClaim(makeSupabase({}, {}), "rec1", "actor");
    expect(out.status).toBe("NEEDS_HUMAN_LOOKUP");
    expect(out.pending).toBe(false);
  });
});
