import { describe, it, expect } from "vitest";
import { riderKeyOf, MAX_CONCURRENT_ROBOT_JOBS } from "@/lib/robotQueue.server";

// Real rows pulled from production for the 6 Yibrah Kidane bills.
const rows = [
  { rider_id: "e6ec68fd-4317-4c44-9f5c-f973ff92d1f7", riders: { medicaid_id: "G797686" }, paper_driver_name: "YIBRAH KIDANE" },
  { rider_id: "644b32fd-a245-437d-a68a-1bec679814e0", riders: { medicaid_id: "P048733" }, paper_driver_name: "YIBRAH KIDANE" },
  { rider_id: "6b998dd3-4019-4e0e-b634-f4e73fa36778", riders: { medicaid_id: "D067288" }, paper_driver_name: "YIBRAH KIDANE" },
  { rider_id: "c5303fbe-7692-4217-bae3-5e543484da12", riders: { medicaid_id: "I392940" }, paper_driver_name: "YIBRAH KIDANE" },
  { rider_id: "d90ce4f1-30f1-4de7-9c0f-81847bb18037", riders: { medicaid_id: "S036925" }, paper_driver_name: "YIBRAH KIDANE" },
  { rider_id: "d6c26109-6d38-46f0-acda-a9d249bff2b0", riders: { medicaid_id: "D2602236" }, paper_driver_name: "YIBRAH KIDANE" },
];

describe("same-driver different-passenger bills", () => {
  it("never share a throttle key", () => {
    const keys = rows.map(riderKeyOf);
    expect(new Set(keys).size).toBe(6);
    expect(keys.every((k) => !String(k).toLowerCase().includes("kidane"))).toBe(true);
    // Strict single flight: these six bills queue behind one another instead of
    // opening six portal sessions.
    expect(MAX_CONCURRENT_ROBOT_JOBS).toBe(1);
  });
});
