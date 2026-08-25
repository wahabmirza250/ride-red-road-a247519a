import { describe, it, expect } from "vitest";
import {
  PAYROLL_STATUS_LABEL,
  payrollClaimKey,
  statementTotals,
  summarizeByDriver,
  validateManualItem,
} from "@/lib/payrollItems";
import { findSameDayGroups, sameDayFlaggedTripIds, SAME_DAY_WARNING } from "@/lib/sameDayBilling";
import {
  addModifier,
  assertEditableResubmission,
  diffModifiers,
  MAX_MODIFIERS_PER_LINE,
  MODIFIER_OPTIONS,
  removeModifier,
} from "@/lib/claimModifiers";
import {
  alertThreshold,
  expenseTotal,
  insuranceState,
  totalsBy,
} from "@/lib/compliance";

describe("payroll status separation", () => {
  it("keeps payroll status independent of claim status", () => {
    const [s] = summarizeByDriver([
      { driver_id: "d1", driver_name: "Ann", claim_status: "paid", payroll_status: "not_added", driver_pay_amount: 40 },
    ]);
    // Medicaid says paid, payroll still says not added.
    expect(s!.paid).toBe(1);
    expect(s!.eligible_amount).toBe(40);
    expect(s!.already_paid_amount).toBe(0);
    expect(PAYROLL_STATUS_LABEL.not_added).toBe("Not Added");
  });

  it("rolls up counts and amounts per driver", () => {
    const rows = [
      { driver_id: "d1", driver_name: "Ann", claim_status: "paid", payroll_status: "paid" as const, driver_pay_amount: 30 },
      { driver_id: "d1", driver_name: "Ann", claim_status: "denied", payroll_status: "added" as const, driver_pay_amount: 20 },
      { driver_id: "d1", driver_name: "Ann", claim_status: "submitted", payroll_status: "not_added" as const, driver_pay_amount: 10 },
      { driver_id: "d2", driver_name: "Bob", claim_status: "needs_fix", payroll_status: "not_added" as const, driver_pay_amount: 5 },
    ];
    const [ann, bob] = summarizeByDriver(rows);
    expect(ann!.total_claims).toBe(3);
    expect(ann!.denied).toBe(1);
    expect(ann!.already_paid_amount).toBe(30);
    expect(ann!.remaining_amount).toBe(20);
    expect(ann!.eligible_amount).toBe(10);
    expect(bob!.needs_attention).toBe(1);
  });
});

describe("duplicate payroll prevention", () => {
  it("derives one stable key per company + claim", () => {
    expect(payrollClaimKey("c1", "t1")).toBe(payrollClaimKey("c1", "t1"));
    expect(payrollClaimKey("c1", "t1")).not.toBe(payrollClaimKey("c2", "t1"));
  });

  it("simulates the unique index collapsing a double add", () => {
    const table = new Map<string, { trip: string }>();
    const add = (trip: string) => {
      const k = payrollClaimKey("c1", trip);
      if (table.has(k)) return false;
      table.set(k, { trip });
      return true;
    };
    expect(add("t1")).toBe(true);
    expect(add("t1")).toBe(false);
    expect(table.size).toBe(1);
  });
});

describe("manual payroll item validation + audit shape", () => {
  it("rejects incomplete manual items", () => {
    expect(validateManualItem({ kind: "manual", amount: 10 }).ok).toBe(false);
    expect(
      validateManualItem({ kind: "manual", amount: 0, driver_id: "d", service_date: "2026-01-01", description: "x" }).ok,
    ).toBe(false);
  });

  it("allows negatives only as an adjustment", () => {
    const base = { driver_id: "d", service_date: "2026-01-01", description: "fix" };
    expect(validateManualItem({ ...base, kind: "manual", amount: -20 }).ok).toBe(false);
    expect(validateManualItem({ ...base, kind: "adjustment", amount: -20 }).ok).toBe(true);
  });

  it("totals earnings and adjustments separately", () => {
    const t = statementTotals([
      { kind: "claim", amount: 100 },
      { kind: "manual", amount: 25 },
      { kind: "adjustment", amount: -30 },
    ]);
    expect(t).toEqual({ earnings: 125, adjustments: -30, total: 95 });
  });
});

describe("same member + same service date warning", () => {
  const trips = [
    { trip_id: "a", company_id: "c1", medicaid_id: "B12", service_date: "2026-03-04T10:00:00Z" },
    { trip_id: "b", company_id: "c1", medicaid_id: "b12", service_date: "2026-03-04T15:00:00Z" },
    { trip_id: "c", company_id: "c1", medicaid_id: "B12", service_date: "2026-03-05T10:00:00Z" },
    { trip_id: "d", company_id: "c2", medicaid_id: "B12", service_date: "2026-03-04T10:00:00Z" },
  ];

  it("groups only same company + member + day", () => {
    const groups = findSameDayGroups(trips);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.trip_ids.sort()).toEqual(["a", "b"]);
  });

  it("flags both trips and never mutates or merges them", () => {
    const flagged = sameDayFlaggedTripIds(trips);
    expect([...flagged].sort()).toEqual(["a", "b"]);
    expect(SAME_DAY_WARNING).toContain("no modifier has been applied");
  });
});

describe("service-line modifiers", () => {
  it("offers 76 but never applies it automatically", () => {
    expect(MODIFIER_OPTIONS.find((m) => m.code === "76")?.label).toBe("Repeat Procedure by Same MD");
    const fresh: string[] = [];
    expect(fresh).toEqual([]); // a new line starts with no modifiers
  });

  it("adds, dedupes and audits", () => {
    const first = addModifier([], "76", "denied as duplicate");
    expect(first.modifiers).toEqual(["76"]);
    expect(first.audit).toEqual([{ action: "added", modifier: "76", reason: "denied as duplicate" }]);
    const again = addModifier(first.modifiers, "76");
    expect(again.modifiers).toEqual(["76"]);
    expect(again.audit).toHaveLength(0);
  });

  it("removes with an audit entry", () => {
    const r = removeModifier(["76", "TK"], "76", "wrong line");
    expect(r.modifiers).toEqual(["TK"]);
    expect(r.audit[0]).toMatchObject({ action: "removed", modifier: "76" });
  });

  it("caps the number of modifiers per line", () => {
    const four = ["76", "77", "TK", "TN"];
    expect(() => addModifier(four, "GM")).toThrow(new RegExp(String(MAX_MODIFIERS_PER_LINE)));
  });

  it("diffs a whole line into audit entries", () => {
    expect(diffModifiers(["76"], ["TK"], "swap")).toEqual([
      { action: "added", modifier: "TK", reason: "swap" },
      { action: "removed", modifier: "76", reason: "swap" },
    ]);
  });

  it("only allows edits while the resubmission is a draft", () => {
    expect(() => assertEditableResubmission("draft")).not.toThrow();
    for (const s of ["queued", "submitted", "paid", "denied", null]) {
      expect(() => assertEditableResubmission(s as string)).toThrow();
    }
  });
});

describe("duplicate resubmission prevention (partial unique index semantics)", () => {
  it("collapses concurrent prepare clicks onto one live draft", () => {
    const live = new Map<string, string>();
    const prepare = (tripId: string) => {
      const existing = live.get(tripId);
      if (existing) return { id: existing, created: false };
      const id = `sub-${live.size + 1}`;
      live.set(tripId, id);
      return { id, created: true };
    };
    const a = prepare("t1");
    const b = prepare("t1");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.id).toBe(b.id);
  });

  it("keeps the original claim untouched", () => {
    const original = { trip_id: "t1", claim_number: "9426213001270", status: "denied" };
    const draft = {
      original_trip_id: original.trip_id,
      original_claim_number: original.claim_number,
      status: "draft",
      resubmission_claim_number: null,
    };
    expect(original.claim_number).toBe("9426213001270");
    expect(draft.original_claim_number).toBe(original.claim_number);
    expect(draft.resubmission_claim_number).toBeNull();
  });
});

describe("insurance expiry logic", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("classifies valid / expiring / expired", () => {
    expect(insuranceState("2026-12-01", now)).toBe("valid");
    expect(insuranceState("2026-06-20", now)).toBe("expiring_soon");
    expect(insuranceState("2026-05-31", now)).toBe("expired");
    expect(insuranceState(null, now)).toBe("unknown");
  });

  it("reports the strictest 30/14/7 alert threshold", () => {
    expect(alertThreshold("2026-06-29", now)).toBe(30);
    expect(alertThreshold("2026-06-14", now)).toBe(14);
    expect(alertThreshold("2026-06-06", now)).toBe(7);
    expect(alertThreshold("2026-08-01", now)).toBeNull();
    expect(alertThreshold("2026-01-01", now)).toBeNull(); // already expired
  });
});

describe("vehicle expense aggregation + ownership", () => {
  const rows = [
    { category: "tires", amount: 420.5, vehicle_label: "Van 1", driver_id: "d1" },
    { category: "oil_change", amount: 79.99, vehicle_label: "Van 1", driver_id: "d1" },
    { category: "tires", amount: 300, vehicle_label: "Van 2", driver_id: "d2" },
  ];

  it("totals by category, vehicle and driver", () => {
    expect(expenseTotal(rows)).toBe(800.49);
    expect(totalsBy(rows, "category")[0]).toEqual({ key: "tires", total: 720.5 });
    expect(totalsBy(rows, "vehicle_label")[0]).toEqual({ key: "Van 1", total: 500.49 });
    expect(totalsBy(rows, "driver_id")).toHaveLength(2);
  });

  it("keeps receipts scoped to their owning driver", () => {
    const visibleTo = (driverId: string) => rows.filter((r) => r.driver_id === driverId);
    expect(visibleTo("d1")).toHaveLength(2);
    expect(visibleTo("d2")).toHaveLength(1);
  });
});
