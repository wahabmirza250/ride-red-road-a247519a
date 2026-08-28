import { describe, expect, it } from "vitest";
import {
  canMergePair,
  findDuplicateDriverGroups,
  normalizePhone,
  type DriverIdentity,
} from "@/lib/driverDuplicates";

const d = (o: Partial<DriverIdentity> & { id: string }): DriverIdentity => ({
  user_id: null,
  company_id: "co-1",
  email: null,
  phone: null,
  first_name: null,
  last_name: null,
  created_at: "2026-01-01T00:00:00Z",
  activity: 0,
  ...o,
});

describe("duplicate driver detection", () => {
  it("normalizes phone numbers to the last 10 digits", () => {
    expect(normalizePhone("+1 (563) 307-5734")).toBe("5633075734");
    expect(normalizePhone("12345")).toBe("");
  });

  it("groups on a shared phone number as strong evidence", () => {
    const groups = findDuplicateDriverGroups([
      d({ id: "a", phone: "563-307-5734", first_name: "Wahab", last_name: "Mirza" }),
      d({ id: "b", phone: "+15633075734", first_name: "Zara", last_name: "Dan" }),
      d({ id: "c", phone: "999-000-1111" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.strength).toBe("strong");
    expect(groups[0]!.drivers.map((x) => x.id).sort()).toEqual(["a", "b"]);
    // Different names on the same phone → never auto-ready.
    expect(groups[0]!.reviewReady).toBe(false);
    expect(groups[0]!.notes.join(" ")).toMatch(/Different names/);
  });

  it("treats a name-only match as supporting evidence, never review-ready", () => {
    const groups = findDuplicateDriverGroups([
      d({ id: "a", first_name: "Khalid", last_name: "Fadul", email: "khalid.fadul@x.com" }),
      d({ id: "b", first_name: "KHALID", last_name: "FADUL", email: "lamar1@x.com" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.strength).toBe("supporting");
    expect(groups[0]!.reviewReady).toBe(false);
  });

  it("suggests the busiest record as the keeper", () => {
    const groups = findDuplicateDriverGroups([
      d({ id: "old", user_id: "u1", activity: 2, created_at: "2025-01-01T00:00:00Z" }),
      d({ id: "busy", user_id: "u1", activity: 40 }),
    ]);
    expect(groups[0]!.suggestedKeeperId).toBe("busy");
  });

  it("finds nothing when every driver is distinct", () => {
    expect(
      findDuplicateDriverGroups([
        d({ id: "a", email: "a@x.com", phone: "5550000001", first_name: "A" }),
        d({ id: "b", email: "b@x.com", phone: "5550000002", first_name: "B" }),
      ]),
    ).toEqual([]);
  });

  it("refuses merges across companies, with the same row, or without shared identity", () => {
    const a = d({ id: "a", company_id: "co-1", email: "x@y.com" });
    expect(canMergePair(a, a).ok).toBe(false);
    expect(canMergePair(a, d({ id: "b", company_id: "co-2", email: "x@y.com" })).ok).toBe(false);
    expect(canMergePair(a, d({ id: "c", email: "other@y.com" })).ok).toBe(false);
    expect(canMergePair(a, d({ id: "d", email: "X@Y.com" })).ok).toBe(true);
  });
});
