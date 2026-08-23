import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL_MS,
  addRiderSlot,
  buildCreateTripPayload,
  buildPdfArgs,
  clearDraft,
  completedSteps,
  createEmptyDraft,
  draftStorageKey,
  isDraftSubmittable,
  loadDraft,
  pushRecentAddress,
  readRecentAddresses,
  removeRiderSlot,
  saveDraft,
  updateLeg,
  updateSlot,
  validateDetailsStep,
  validateSignStep,
  validateTripStep,
  withTripKind,
  type DraftRider,
  type DriverTripDraft,
  type MinimalStorage,
} from "./driverTripDraft";

function memStorage(): MinimalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const rider: DraftRider = {
  id: "rider-1",
  full_name: "Jane Doe",
  medicaid_id: "A1234567",
  dob: "1970-01-01",
  phone: null,
  address: null,
};

function readyDraft(): DriverTripDraft {
  let d = createEmptyDraft();
  d = addRiderSlot(d, rider);
  d = { ...d, vehicle_type: "ambulatory", plate: "ABC-123", driver_full_name: "Sam Driver" };
  d = updateLeg(d, 0, {
    leg_date: "2026-08-20",
    pickup_time: "09:00",
    pickup_address: "1 Home St",
    pickup_odometer: "1000",
    dropoff_time: "09:30",
    dropoff_address: "2 Clinic Ave",
    dropoff_odometer: "1012",
  });
  d = updateSlot(d, rider.id, { signature_data_url: "data:image/png;base64,AAA" });
  return d;
}

describe("draft recovery", () => {
  it("round-trips a draft through storage", () => {
    const s = memStorage();
    const key = draftStorageKey("acme", "user-1");
    const draft = readyDraft();
    saveDraft(s, key, draft);
    const restored = loadDraft(s, key);
    expect(restored?.rider_slots[0].rider.full_name).toBe("Jane Doe");
    expect(restored?.legs[0].pickup_address).toBe("1 Home St");
    expect(restored?.plate).toBe("ABC-123");
  });

  it("does not persist an untouched draft", () => {
    const s = memStorage();
    const key = draftStorageKey("acme", "user-1");
    saveDraft(s, key, createEmptyDraft());
    expect(loadDraft(s, key)).toBeNull();
  });

  it("discards expired drafts", () => {
    const s = memStorage();
    const key = draftStorageKey("acme", "user-1");
    saveDraft(s, key, readyDraft());
    expect(loadDraft(s, key, Date.now() + DRAFT_TTL_MS + 1000)).toBeNull();
    expect(s.map.has(key)).toBe(false);
  });

  it("discards drafts from an older schema version", () => {
    const s = memStorage();
    const key = draftStorageKey("acme", "user-1");
    s.setItem(key, JSON.stringify({ version: 1, updated_at: new Date().toISOString() }));
    expect(loadDraft(s, key)).toBeNull();
  });

  it("ignores corrupt json", () => {
    const s = memStorage();
    const key = draftStorageKey("acme", "user-1");
    s.setItem(key, "{not json");
    expect(loadDraft(s, key)).toBeNull();
  });

  it("clears a draft on demand", () => {
    const s = memStorage();
    const key = draftStorageKey("acme", "user-1");
    saveDraft(s, key, readyDraft());
    clearDraft(s, key);
    expect(loadDraft(s, key)).toBeNull();
  });
});

describe("company / driver isolation", () => {
  it("scopes the draft key by company and driver", () => {
    const s = memStorage();
    saveDraft(s, draftStorageKey("acme", "user-1"), readyDraft());
    expect(loadDraft(s, draftStorageKey("acme", "user-2"))).toBeNull();
    expect(loadDraft(s, draftStorageKey("other", "user-1"))).toBeNull();
    expect(loadDraft(s, draftStorageKey("acme", "user-1"))).not.toBeNull();
  });
});

describe("required-field validation", () => {
  it("flags every missing trip field", () => {
    const issues = validateTripStep(createEmptyDraft());
    expect(issues["leg0.pickup_address"]).toBeTruthy();
    expect(issues["leg0.dropoff_address"]).toBeTruthy();
    expect(issues["leg0.pickup_odometer"]).toBeTruthy();
    expect(issues["leg0.dropoff_odometer"]).toBeTruthy();
  });

  it("rejects a drop-off odometer below pickup", () => {
    const d = updateLeg(readyDraft(), 0, { dropoff_odometer: "900" });
    expect(validateTripStep(d)["leg0.dropoff_odometer"]).toMatch(/lower than pickup/i);
  });

  it("requires vehicle type and plate", () => {
    const issues = validateDetailsStep(createEmptyDraft());
    expect(issues["vehicle_type"]).toBeTruthy();
    expect(issues["plate"]).toBeTruthy();
  });

  it("passes a complete draft", () => {
    expect(isDraftSubmittable(readyDraft())).toBe(true);
    expect(completedSteps(readyDraft())).toEqual({
      passenger: true,
      trip: true,
      details: true,
      sign: true,
      review: true,
    });
  });

  it("validates the return leg of a round trip", () => {
    const d = withTripKind(readyDraft(), "round_trip");
    expect(d.legs).toHaveLength(2);
    expect(d.legs[1].pickup_address).toBe("2 Clinic Ave");
    expect(validateTripStep(d)["leg1.pickup_odometer"]).toBeTruthy();
    expect(isDraftSubmittable(d)).toBe(false);
  });
});

describe("passenger reuse", () => {
  it("never adds the same rider twice", () => {
    let d = addRiderSlot(createEmptyDraft(), rider);
    d = addRiderSlot(d, rider);
    expect(d.rider_slots).toHaveLength(1);
  });

  it("blocks a second passenger unless the trip is a group tour", () => {
    const other = { ...rider, id: "rider-2", full_name: "Bob Roe" };
    let d = addRiderSlot(createEmptyDraft(), rider);
    expect(addRiderSlot(d, other).rider_slots).toHaveLength(1);
    d = addRiderSlot(withTripKind(d, "group_tour"), other);
    expect(d.rider_slots).toHaveLength(2);
    expect(withTripKind(d, "one_way").rider_slots).toHaveLength(1);
  });

  it("prefills the signer name from the reused passenger record", () => {
    const d = addRiderSlot(createEmptyDraft(), rider);
    expect(d.rider_slots[0].signer_name).toBe("Jane Doe");
    expect(removeRiderSlot(d, rider.id).rider_slots).toHaveLength(0);
  });

  it("remembers recent destinations to avoid retyping", () => {
    const s = memStorage();
    pushRecentAddress(s, "2 Clinic Ave");
    pushRecentAddress(s, "1 Home St");
    pushRecentAddress(s, "2 Clinic Ave");
    expect(readRecentAddresses(s)).toEqual(["2 Clinic Ave", "1 Home St"]);
  });
});

describe("signature completion", () => {
  it("blocks submit until every passenger has signed", () => {
    let d = readyDraft();
    d = updateSlot(d, rider.id, { signature_data_url: null });
    expect(validateSignStep(d)[`sig.${rider.id}`]).toMatch(/needs to sign/i);
    d = updateSlot(d, rider.id, { signature_data_url: "data:image/png;base64,AAA", signer_name: "  " });
    expect(validateSignStep(d)[`name.${rider.id}`]).toBeTruthy();
    d = updateSlot(d, rider.id, { signer_name: "Escort Ann", signed_by_escort: true });
    expect(validateSignStep(d)).toEqual({});
  });
});

describe("billing payload compatibility", () => {
  it("produces the exact createNemtTripGroup payload", () => {
    expect(buildCreateTripPayload(readyDraft())).toEqual({
      trip_kind: "one_way",
      vehicle_type: "ambulatory",
      vehicle_plate: "ABC-123",
      vehicle_vin: null,
      escort_name: null,
      riders: [{ rider_id: "rider-1", identity_verified: true, signed_by_escort: false }],
      legs: [
        {
          leg_index: 1,
          leg_date: "2026-08-20",
          pickup_time: "09:00",
          pickup_odometer: 1000,
          pickup_address: "1 Home St",
          dropoff_time: "09:30",
          dropoff_odometer: 1012,
          dropoff_address: "2 Clinic Ave",
        },
      ],
    });
  });

  it("produces PDF handoff metadata with the resolved rider identifier", () => {
    const d = readyDraft();
    const args = buildPdfArgs(d, d.rider_slots[0], {
      driverName: "Sam Driver",
      riderOverride: { ...rider, medicaid_id: "FULLSSN123456789" },
    });
    expect(args.rider.medicaid_id).toBe("FULLSSN123456789");
    expect(args.driverName).toBe("Sam Driver");
    expect(args.vehiclePlate).toBe("ABC-123");
    expect(args.vehicleType).toBe("ambulatory");
    expect(args.tripKind).toBe("one_way");
    expect(args.signatureUrl).toBe("data:image/png;base64,AAA");
    expect(args.signatureName).toBe("Jane Doe");
    expect(args.legs).toEqual(buildCreateTripPayload(d).legs);
  });

  it("keeps odometer values numeric for the billing mileage calculation", () => {
    const legs = buildCreateTripPayload(withTripKind(readyDraft(), "round_trip")).legs;
    expect(typeof legs[0].pickup_odometer).toBe("number");
    expect(typeof legs[1].dropoff_odometer).toBe("number"); // empty return leg is caught by validation, never sent as a string
  });
});
