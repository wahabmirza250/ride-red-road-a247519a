import { describe, expect, it } from "vitest";
import {
  addRiderSlot,
  buildCreateTripPayload,
  createEmptyDraft,
  draftStatusLabel,
  isDraftSavable,
  isDraftSubmittable,
  missingForCompletion,
  updateLeg,
  updateSlot,
  validateStepForNavigation,
  withTripKind,
  type DraftRider,
  type DriverTripDraft,
} from "../driverTripDraft";

const rider: DraftRider = {
  id: "rider-1",
  full_name: "Jane Doe",
  medicaid_id: "A1234567",
  dob: "1970-01-01",
  phone: null,
  address: null,
};

/** Only the data that exists when a driver STARTS a trip. */
function startedDraft(): DriverTripDraft {
  let d = addRiderSlot(createEmptyDraft(), rider);
  d = { ...d, vehicle_type: "ambulatory", plate: "ABC-123", driver_full_name: "Sam Driver" };
  return updateLeg(d, 0, {
    leg_date: "2026-08-20",
    pickup_time: "09:00",
    pickup_address: "1 Home St",
    pickup_odometer: "1000",
  });
}

function finishedDraft(): DriverTripDraft {
  let d = updateLeg(startedDraft(), 0, {
    dropoff_address: "2 Clinic Ave",
    dropoff_time: "09:30",
    dropoff_odometer: "1012",
  });
  return updateSlot(d, rider.id, { signature_data_url: "data:image/png;base64,AAA" });
}

describe("stage 1 — save an in-progress trip", () => {
  it("allows saving before drop-off odometer and signature exist", () => {
    const d = updateLeg(startedDraft(), 0, { dropoff_address: "2 Clinic Ave" });
    expect(isDraftSavable(d)).toBe(true);
    expect(isDraftSubmittable(d)).toBe(false);
  });

  it("still requires the pickup odometer at start", () => {
    const d = updateLeg(startedDraft(), 0, { dropoff_address: "2 Clinic", pickup_odometer: "" });
    expect(isDraftSavable(d)).toBe(false);
    expect(validateStepForNavigation("trip", d)["leg0.pickup_odometer"]).toMatch(/required/i);
  });

  it("does not block wizard navigation on completion-only data", () => {
    const d = updateLeg(startedDraft(), 0, { dropoff_address: "2 Clinic Ave" });
    expect(validateStepForNavigation("trip", d)).toEqual({});
    expect(validateStepForNavigation("sign", d)).toEqual({});
  });
});

describe("stage 2 — completing later", () => {
  it("lists exactly what is still missing", () => {
    const d = updateLeg(startedDraft(), 0, { dropoff_address: "2 Clinic Ave" });
    const missing = missingForCompletion(d).join(" | ");
    expect(missing).toMatch(/drop-off odometer/i);
    expect(missing).toMatch(/drop-off time/i);
    expect(missing).toMatch(/Signature/i);
    expect(draftStatusLabel(d)).toBe("Needs completion");
  });

  it("unblocks final submit once completion data arrives", () => {
    const d = finishedDraft();
    expect(missingForCompletion(d)).toEqual([]);
    expect(isDraftSubmittable(d)).toBe(true);
    expect(draftStatusLabel(d)).toBe("Ready to submit");
  });

  it("asks for return-leg readings only once that leg exists", () => {
    const rt = withTripKind(finishedDraft(), "round_trip");
    expect(missingForCompletion(rt).join(" | ")).toMatch(/Return: drop-off odometer/i);
    const done = updateLeg(rt, 1, {
      leg_date: "2026-08-20",
      pickup_time: "13:00",
      dropoff_time: "13:40",
      pickup_odometer: "1012",
      dropoff_odometer: "1025",
    });
    expect(missingForCompletion(done)).toEqual([]);
  });
});

describe("billing/PDF contract is unchanged", () => {
  it("keeps numeric pickup/dropoff odometers in the final payload", () => {
    const payload = buildCreateTripPayload(finishedDraft());
    expect(payload.legs[0].pickup_odometer).toBe(1000);
    expect(payload.legs[0].dropoff_odometer).toBe(1012);
    expect(typeof payload.legs[0].pickup_odometer).toBe("number");
  });

  it("refuses to build a payload from a half-finished saved trip", () => {
    const d = updateLeg(startedDraft(), 0, { dropoff_address: "2 Clinic Ave" });
    expect(() => buildCreateTripPayload(d)).toThrow(/odometer/i);
  });
});
