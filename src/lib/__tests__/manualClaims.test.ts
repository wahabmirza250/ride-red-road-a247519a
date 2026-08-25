import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { manualPayrollLine, validateManualClaim, round2 } from "@/lib/manualClaims";
import { resolvePayPlan } from "@/lib/payPlans";

describe("manual claim validation", () => {
  const base = {
    driver_id: "d1",
    passenger_name: "Jane Doe",
    service_date: "2026-08-01",
    driver_pay_amount: 40,
  };

  it("accepts a complete manual trip", () => {
    expect(validateManualClaim(base).ok).toBe(true);
  });

  it("requires a driver, passenger and date", () => {
    expect(validateManualClaim({ ...base, driver_id: null }).ok).toBe(false);
    expect(validateManualClaim({ ...base, passenger_name: "  " }).ok).toBe(false);
    expect(validateManualClaim({ ...base, service_date: null }).ok).toBe(false);
  });

  it("rejects negative driver pay (deductions belong in an adjustment)", () => {
    expect(validateManualClaim({ ...base, driver_pay_amount: -10 }).ok).toBe(false);
  });

  it("allows a zero-pay informational record", () => {
    expect(validateManualClaim({ ...base, driver_pay_amount: 0 }).ok).toBe(true);
  });

  it("rejects a negative billed amount", () => {
    expect(validateManualClaim({ ...base, billed_amount: -1 }).ok).toBe(false);
  });
});

describe("manual driver pay is preserved into payroll", () => {
  const rec = {
    id: "11111111-1111-1111-1111-111111111111",
    company_id: "c1",
    driver_id: "d1",
    passenger_name: "Jane Doe",
    service_date: "2026-08-01T00:00:00.000Z",
    claim_number: "EXT-99",
    driver_pay_amount: 47.37,
  };

  it("uses the entered amount verbatim", () => {
    const line = manualPayrollLine(rec, "user-1");
    expect(line.amount).toBe(47.37);
    expect(line.kind).toBe("manual");
    expect(line.ref_id).toBe(rec.id);
    expect(line.payroll_status).toBe("added");
    expect(line.service_date).toBe("2026-08-01");
  });

  it("does NOT apply the driver's pay plan percentage", () => {
    const plan = resolvePayPlan(
      { default_plan: "commission", default_commission_percentage: 60 } as never,
      null,
    );
    const planned = round2((100 * Number(plan.commission_percentage ?? 0)) / 100);
    const line = manualPayrollLine({ ...rec, driver_pay_amount: 100 }, "user-1");
    expect(line.amount).toBe(100);
    expect(line.amount).not.toBe(planned);
  });

  it("rounds to cents", () => {
    expect(manualPayrollLine({ ...rec, driver_pay_amount: 10.005 }, "u").amount).toBe(10.01);
  });
});

/**
 * Structural guarantee: manual trips live in `manual_claim_records`, a table
 * no submission/queue/robot/reconcile module is allowed to reference.
 */
describe("manual trips can never reach the HCPF queue", () => {
  const root = join(process.cwd(), "src", "lib");
  const submissionFiles = readdirSync(root).filter((f) =>
    /^(submission|robot|autoRetry|billingHelpers|unverifiedClaim|claimStatusSync|resubmission|billing)/i.test(
      f,
    ) && f.endsWith(".ts"),
  );

  it("finds the submission modules to check", () => {
    expect(submissionFiles.length).toBeGreaterThan(5);
  });

  for (const f of submissionFiles) {
    it(`${f} never touches manual_claim_records`, () => {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).not.toContain("manual_claim_records");
      expect(src).not.toContain("manualClaims");
    });
  }

  it("the manual claim modules never call the submission queue", () => {
    for (const f of ["manualClaims.ts", "manualClaims.server.ts", "manualClaims.functions.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      for (const forbidden of [
        "enqueueOrStartRobot",
        "startRobotSubmission",
        "startRobotForRecords",
        "submissionQueue",
        "robotQueue",
        "robotAdapter",
        "medicaid_trips",
        "billing_records",
        "submit-claim",
      ]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });
});
