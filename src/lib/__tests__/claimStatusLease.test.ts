import { describe, expect, it } from "vitest";
import { rankStatusCandidates, type StatusCandidate } from "@/lib/claimStatusSync.server";

const row = (
  i: number,
  claim: string | null,
  company = "A",
  next: string | null = null,
): StatusCandidate => ({
  record_id: `r${i}`,
  company_id: company,
  claim_number: claim,
  next_at: next,
  created_at: new Date(2026, 0, 1, 0, i).toISOString(),
});

describe("claim status lease candidate ranking", () => {
  it("never lets claim-less rows consume the per-company slots (production bug)", () => {
    const rows = [
      ...Array.from({ length: 300 }, (_, i) => row(i, null)), // oldest, no claim number
      ...Array.from({ length: 50 }, (_, i) => row(i + 300, `C${i}`)),
    ];
    const picked = rankStatusCandidates(rows, { perCompany: 8, global: 20 });
    expect(picked).toHaveLength(8);
    expect(picked.every((p) => p.claim_number)).toBe(true);
  });

  it("respects the per-company cap and the global cap", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => row(i, `A${i}`, "A")),
      ...Array.from({ length: 30 }, (_, i) => row(i + 100, `B${i}`, "B")),
      ...Array.from({ length: 30 }, (_, i) => row(i + 200, `C${i}`, "C")),
    ];
    const picked = rankStatusCandidates(rows, { perCompany: 8, global: 20 });
    expect(picked).toHaveLength(20);
    for (const c of ["A", "B", "C"]) {
      expect(picked.filter((p) => p.company_id === c).length).toBeLessThanOrEqual(8);
    }
  });

  it("checks never-checked claims first, then the oldest due", () => {
    const rows = [
      row(1, "OLD", "A", new Date(Date.now() - 60_000).toISOString()),
      row(2, "NEVER", "A", null),
    ];
    const picked = rankStatusCandidates(rows, { perCompany: 8, global: 20 });
    expect(picked.map((p) => p.claim_number)).toEqual(["NEVER", "OLD"]);
  });

  it("blank/whitespace claim numbers are not leasable", () => {
    const picked = rankStatusCandidates([row(1, "   "), row(2, "OK")], {
      perCompany: 8,
      global: 20,
    });
    expect(picked.map((p) => p.claim_number)).toEqual(["OK"]);
  });
});
