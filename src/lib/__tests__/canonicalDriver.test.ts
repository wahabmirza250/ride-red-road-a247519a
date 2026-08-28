import { describe, expect, it } from "vitest";
import {
  activeDrivers,
  canonicalDriverId,
  canonicalDriverMap,
  driverMatchesSearch,
  filterDrivers,
} from "@/lib/canonicalDriver";
import { mergeDriverPayConfig, resolvePayPlan } from "@/lib/payPlans";

describe("canonical driver resolution", () => {
  const rows = [
    { id: "keep", merged_into: null },
    { id: "dupe", merged_into: "keep" },
    { id: "dupe2", merged_into: "dupe" },
    { id: "other", merged_into: null },
  ];

  it("folds a merged duplicate onto the driver that was kept", () => {
    expect(canonicalDriverId("dupe", rows)).toBe("keep");
    expect(canonicalDriverId("dupe2", rows)).toBe("keep");
    expect(canonicalDriverId("other", rows)).toBe("other");
  });

  it("never loops on a self- or circular reference", () => {
    expect(canonicalDriverId("a", [{ id: "a", merged_into: "a" }])).toBe("a");
    expect(
      canonicalDriverId("a", [
        { id: "a", merged_into: "b" },
        { id: "b", merged_into: "a" },
      ]),
    ).toBe("b");
  });

  it("payroll lists each person once after a merge", () => {
    expect(activeDrivers(rows).map((d) => d.id)).toEqual(["keep", "other"]);
    expect(canonicalDriverMap(rows).get("dupe2")).toBe("keep");
  });

  it("keeps the kept driver's saved percentage after a merge", () => {
    // What the merge leaves in place: the keeper's own row wins.
    const keeperPlan = { plan: "commission", commission_percentage: 65 } as any;
    const resolved = resolvePayPlan({}, mergeDriverPayConfig(keeperPlan, null));
    expect(resolved.commission_percentage).toBe(65);
  });
});

describe("driver search", () => {
  const list = [
    {
      id: "11111111-2222-4333-8444-555555555555",
      first_name: "Wahab",
      last_name: "Mirza",
      email: "wahab@example.com",
      phone: "+1 (563) 307-5734",
      license_number: "CO-99231",
      vehicle_plate: "ABC-123",
      vehicle_make: "Toyota",
      vehicle_model: "Sienna",
    },
    {
      id: "99999999-2222-4333-8444-555555555555",
      first_name: "Khalid",
      last_name: "Fadul",
      email: "khalid@example.com",
      phone: "5551112222",
    },
  ];

  it("matches on name, email, phone, id, licence and vehicle", () => {
    expect(filterDrivers(list, "mirza").map((d) => d.id)).toEqual([list[0]!.id]);
    expect(filterDrivers(list, "KHALID@example.com").map((d) => d.id)).toEqual([list[1]!.id]);
    expect(filterDrivers(list, "(563) 307").map((d) => d.id)).toEqual([list[0]!.id]);
    expect(filterDrivers(list, "co-99231")).toHaveLength(1);
    expect(filterDrivers(list, "sienna")).toHaveLength(1);
    expect(filterDrivers(list, "9999")).toHaveLength(1);
  });

  it("requires every term to match and shows everything when empty", () => {
    expect(driverMatchesSearch(list[0]!, "wahab toyota")).toBe(true);
    expect(driverMatchesSearch(list[0]!, "wahab honda")).toBe(false);
    expect(filterDrivers(list, "   ")).toHaveLength(2);
  });
});
