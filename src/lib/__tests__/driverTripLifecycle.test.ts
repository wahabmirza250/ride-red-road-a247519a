import { describe, expect, it } from "vitest";
import {
  addRiderSlot,
  createEmptyDraft,
  updateLeg,
  updateSlot,
  validateCreateStage,
  type DraftRider,
  type DriverTripDraft,
} from "@/lib/driverTripDraft";
import {
  allowedActions,
  applyTransition,
  blockersFor,
  currentDestination,
  getLifecycle,
  isReadyForBilling,
  MAX_LEGS,
  phaseLabel,
  withLifecycle,
  type ActiveTripDraft,
} from "@/lib/driverTripLifecycle";
import { buildCreateTripPayload } from "@/lib/driverTripDraft";

const rider: DraftRider = {
  id: "rider-1",
  full_name: "Jane Doe",
  medicaid_id: "A123456",
  dob: "1970-01-01",
  phone: null,
  address: null,
};

function baseDraft(): ActiveTripDraft {
  let d: DriverTripDraft = createEmptyDraft();
  d = addRiderSlot(d, rider);
  d = { ...d, vehicle_type: "ambulatory", plate: "ABC-123", driver_full_name: "Driver One" };
  d = updateLeg(d, 0, {
    leg_date: "2026-02-02",
    pickup_time: "09:00",
    pickup_address: "1 Main St",
    dropoff_address: "2 Clinic Rd",
  });
  return withLifecycle({ ...d, server_draft_id: "draft-1" });
}

function completeLeg(d: ActiveTripDraft, pickup: string, dropoff: string): ActiveTripDraft {
  const idx = getLifecycle(d).active_leg;
  let next = getLifecycle(d).phase === "draft" ? applyTransition(d, "start_navigation") : d;
  next = applyTransition(next, "arrive_pickup");
  next = updateLeg(next, idx, { pickup_odometer: pickup, pickup_time: "09:00" }) as ActiveTripDraft;
  next = applyTransition(next, "start_trip");
  next = applyTransition(next, "arrive_dropoff");
  next = updateLeg(next, idx, { dropoff_odometer: dropoff, dropoff_time: "09:40" }) as ActiveTripDraft;
  return applyTransition(next, "complete_leg");
}

describe("driver active trip lifecycle", () => {
  it("creates a trip without any completion data", () => {
    const d = baseDraft();
    expect(validateCreateStage(d)).toEqual({});
    expect(getLifecycle(d).phase).toBe("draft");
    expect(allowedActions(d)).toEqual(["start_navigation"]);
  });

  it("resumes from the persisted phase after a refresh", () => {
    const d = applyTransition(baseDraft(), "start_navigation");
    const roundTripped = withLifecycle(JSON.parse(JSON.stringify(d)));
    expect(getLifecycle(roundTripped).phase).toBe("to_pickup");
    expect(phaseLabel(roundTripped)).toContain("pickup");
    expect(currentDestination(roundTripped)).toEqual({ address: "1 Main St", kind: "pickup" });
  });

  it("never auto-advances: each transition is explicit and ordered", () => {
    const d = baseDraft();
    expect(() => applyTransition(d, "arrive_dropoff")).toThrow();
    const nav = applyTransition(d, "start_navigation");
    expect(() => applyTransition(nav, "start_trip")).toThrow();
  });

  it("requires the pickup odometer only at the pickup", () => {
    let d = applyTransition(baseDraft(), "start_navigation");
    d = applyTransition(d, "arrive_pickup");
    expect(blockersFor(d, "start_trip")).toContain("Pickup odometer");
    d = updateLeg(d, 0, { pickup_odometer: "1000" }) as ActiveTripDraft;
    expect(blockersFor(d, "start_trip")).toEqual([]);
    expect(getLifecycle(applyTransition(d, "start_trip")).phase).toBe("in_trip");
  });

  it("requires drop-off odometer/time at leg completion and rejects negative mileage", () => {
    let d = applyTransition(baseDraft(), "start_navigation");
    d = applyTransition(d, "arrive_pickup");
    d = updateLeg(d, 0, { pickup_odometer: "1000" }) as ActiveTripDraft;
    d = applyTransition(d, "start_trip");
    d = applyTransition(d, "arrive_dropoff");
    expect(blockersFor(d, "complete_leg")).toContain("Drop-off odometer");
    d = updateLeg(d, 0, { dropoff_odometer: "900", dropoff_time: "09:40" }) as ActiveTripDraft;
    expect(blockersFor(d, "complete_leg")).toContain("Drop-off odometer must be ≥ pickup");
    d = updateLeg(d, 0, { dropoff_odometer: "1012" }) as ActiveTripDraft;
    expect(blockersFor(d, "complete_leg")).toEqual([]);
  });

  it("keeps a round trip open with leg 1 complete and leg 2 pending", () => {
    let d = completeLeg({ ...baseDraft(), trip_kind: "round_trip" }, "1000", "1012");
    expect(getLifecycle(d).phase).toBe("leg_complete");
    expect(allowedActions(d)).toContain("next_leg");

    d = applyTransition(d, "next_leg");
    expect(d.legs).toHaveLength(2);
    expect(getLifecycle(d).active_leg).toBe(1);
    expect(getLifecycle(d).phase).toBe("to_pickup");
    // Return leg is pre-filled in reverse but has no readings yet.
    expect(d.legs[1].pickup_address).toBe("2 Clinic Rd");
    expect(d.legs[1].pickup_odometer).toBe("");
  });

  it("caps legs at the billing/PDF contract of two", () => {
    let d = completeLeg({ ...baseDraft(), trip_kind: "round_trip" }, "1000", "1012");
    d = applyTransition(d, "next_leg");
    d = completeLeg(d, "1012", "1025");
    expect(d.legs.length).toBe(MAX_LEGS);
    expect(allowedActions(d)).not.toContain("next_leg");
  });

  it("blocks billing until signatures and every leg are complete", () => {
    let d = completeLeg(baseDraft(), "1000", "1012");
    expect(blockersFor(d, "finish").some((m) => m.startsWith("Signature"))).toBe(true);
    d = updateSlot(d, rider.id, {
      signature_data_url: "data:image/png;base64,AAA",
      signer_name: "Jane Doe",
    }) as ActiveTripDraft;
    expect(blockersFor(d, "finish")).toEqual([]);
    d = applyTransition(d, "finish");
    expect(isReadyForBilling(d)).toBe(true);
  });

  it("preserves the existing billing payload contract with numeric odometers", () => {
    let d = completeLeg(baseDraft(), "1000", "1012.5");
    d = updateSlot(d, rider.id, {
      signature_data_url: "data:image/png;base64,AAA",
      signer_name: "Jane Doe",
    }) as ActiveTripDraft;
    const payload = buildCreateTripPayload(applyTransition(d, "finish"));
    expect(payload.legs[0].pickup_odometer).toBe(1000);
    expect(payload.legs[0].dropoff_odometer).toBe(1012.5);
    expect(payload.riders[0].rider_id).toBe(rider.id);
    expect(payload.vehicle_plate).toBe("ABC-123");
  });

  it("manual Medicaid verification stays out of the lifecycle blockers", () => {
    const d = completeLeg(baseDraft(), "1000", "1012");
    const blockers = blockersFor(d, "finish").join(" ");
    expect(blockers.toLowerCase()).not.toContain("medicaid");
    expect(blockers.toLowerCase()).not.toContain("verif");
  });
});
