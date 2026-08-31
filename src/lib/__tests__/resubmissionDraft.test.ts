import { describe, expect, it } from "vitest";
import {
  applyResubmissionOverrides,
  buildSnapshotFromTrip,
  diffSnapshots,
  effectiveMiles,
  isValidModifier,
  normalizeSnapshot,
  odometerMiles,
  validateDraft,
  type DraftSnapshot,
} from "@/lib/resubmissionDraft";

const trip = {
  id: "trip-1",
  company_id: "co-1",
  pickup_at: "2026-07-30T14:00:00Z",
  pickup_address: "100 A St",
  dropoff_address: "200 B St",
  odometer_start: 1000,
  odometer_end: 1010,
  trip_kind: "one_way",
  vehicle_type: "ambulatory",
  vehicle_plate: "abc123",
  vehicle_vin: "vin9",
  driver_id: "d-1",
  rider_id: "r-1",
  identity_verified: true,
  state_pdf_path: "state-pdfs/x.pdf",
};
const legs = [
  {
    leg_index: 1,
    leg_date: "2026-07-30",
    pickup_time: "09:00:00",
    pickup_address: "100 A St",
    pickup_odometer: 1000,
    dropoff_time: "09:30:00",
    dropoff_address: "200 B St",
    dropoff_odometer: 1010,
  },
];

function baseDraft(): DraftSnapshot {
  const snap = buildSnapshotFromTrip({
    trip,
    legs,
    rider: { full_name: "Jane Doe", medicaid_id: "A1234567" },
    driverName: "Sam Driver",
  });
  return normalizeSnapshot({
    ...snap,
    lines: [
      {
        line_index: 1,
        service_date: "2026-07-30",
        procedure_code: "a0100",
        units: 1,
        miles: 10,
        modifiers: [],
      },
    ],
  });
}

describe("resubmission draft snapshot", () => {
  it("clones the original trip without mutating it", () => {
    const snap = baseDraft();
    const before = JSON.stringify(trip);
    snap.service_date = "2026-08-01";
    snap.legs[0]!.pickup_odometer = 5;
    expect(JSON.stringify(trip)).toBe(before);
    expect(legs[0]!.pickup_odometer).toBe(1000);
  });

  it("reopens a saved draft with the saved values, not the original", () => {
    const saved = { ...baseDraft(), service_date: "2026-08-05", medicaid_id: "b7654321" };
    const reopened = normalizeSnapshot(saved);
    expect(reopened.service_date).toBe("2026-08-05");
    expect(reopened.medicaid_id).toBe("B7654321");
  });

  it("recomputes miles from edited odometers", () => {
    const snap = baseDraft();
    snap.legs[0]!.dropoff_odometer = 1025;
    expect(odometerMiles(snap.legs)).toBe(25);
    expect(effectiveMiles(snap)).toBe(25);
  });

  it("supports a two-leg round trip and never bills the gap between legs", () => {
    const snap = normalizeSnapshot({
      ...baseDraft(),
      trip_kind: "round_trip",
      legs: [
        { ...legs[0], leg_index: 1, pickup_odometer: 10000, dropoff_odometer: 10008 },
        {
          leg_index: 2,
          leg_date: "2026-07-30",
          pickup_time: "13:00",
          dropoff_time: "13:40",
          pickup_address: "200 B St",
          dropoff_address: "100 A St",
          pickup_odometer: 10025,
          dropoff_odometer: 10032,
        },
      ],
      lines: [
        { line_index: 1, units: 1, miles: 8, modifiers: [] },
        { line_index: 2, units: 1, miles: 7, modifiers: [] },
      ],
    });
    expect(odometerMiles(snap.legs)).toBe(15);
    expect(validateDraft(snap).ok).toBe(true);
  });

  it("normalizes and de-duplicates modifiers, uppercase", () => {
    const snap = normalizeSnapshot({
      ...baseDraft(),
      lines: [{ line_index: 1, units: 1, miles: 10, modifiers: [" 76 ", "76", "tk"] }],
    });
    expect(snap.lines[0]!.modifiers).toEqual(["76", "TK"]);
    expect(isValidModifier("7A")).toBe(true);
    expect(isValidModifier("ABC")).toBe(false);
  });
});

describe("resubmission validation", () => {
  it("passes on a complete draft", () => {
    expect(validateDraft(baseDraft()).ok).toBe(true);
  });

  it("requires the member id, service date and driver", () => {
    const snap = normalizeSnapshot({
      ...baseDraft(),
      medicaid_id: null,
      service_date: null,
      driver_id: null,
      driver_name: null,
    });
    const issues = validateDraft(snap).issues.map((i) => i.field);
    expect(issues).toContain("medicaid_id");
    expect(issues).toContain("service_date");
    expect(issues).toContain("driver");
  });

  it("rejects a drop-off odometer below the pickup odometer", () => {
    const snap = baseDraft();
    snap.legs[0]!.dropoff_odometer = 900;
    const res = validateDraft(snap);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => /drop-off odometer must be greater/i.test(i.message))).toBe(true);
  });

  it("allows a mileage override only with a recorded reason", () => {
    const snap = { ...baseDraft(), miles_override: 42 };
    expect(validateDraft(snap).ok).toBe(false);
    const ok = { ...snap, miles_override_reason: "Portal requires the mapped distance." };
    expect(validateDraft(ok).ok).toBe(true);
    expect(effectiveMiles(normalizeSnapshot(ok))).toBe(42);
  });

  it("rejects an invalid custom modifier", () => {
    const snap = normalizeSnapshot({
      ...baseDraft(),
      lines: [{ line_index: 1, units: 1, miles: 10, modifiers: ["Z"] }],
    });
    expect(validateDraft(snap).ok).toBe(false);
  });
});

describe("original -> corrected diff", () => {
  it("lists every changed field including service lines", () => {
    const original = baseDraft();
    const corrected = normalizeSnapshot({
      ...original,
      service_date: "2026-08-02",
      lines: [{ ...original.lines[0], units: 2, modifiers: ["76"] }],
    });
    const changes = diffSnapshots(original, corrected);
    const fields = changes.map((c) => c.field);
    expect(fields).toContain("service_date");
    expect(fields).toContain("lines.0.units");
    expect(fields).toContain("lines.0.modifiers");
    for (const c of changes) {
      expect(["string", "number", "boolean", "object"]).toContain(typeof c.before);
    }
  });
});

describe("robot payload uses the corrected draft", () => {
  const basePayload = {
    trip_date: "07/30/2026",
    service_date: "07/30/2026",
    date_of_service: "07/30/2026",
    from_date: "07/30/2026",
    to_date: "07/30/2026",
    medicaid_member_id: "A1234567",
    member_id: "A1234567",
    patient_number: "A1234567",
    miles: 10,
    pickup_odometer: 1000,
    dropoff_odometer: 1010,
    trip_units: 1,
    is_round_trip: false,
  };

  it("leaves a first-time submission payload untouched when there is no draft", () => {
    expect(applyResubmissionOverrides({ ...basePayload }, null)).toEqual(basePayload);
  });

  it("applies corrected date, member id, odometers, units and modifiers", () => {
    const snap = normalizeSnapshot({
      ...baseDraft(),
      service_date: "2026-08-02",
      medicaid_id: "b7654321",
      trip_kind: "round_trip",
      legs: [
        { leg_index: 1, pickup_odometer: 10000, dropoff_odometer: 10008 },
        { leg_index: 2, pickup_odometer: 10025, dropoff_odometer: 10032 },
      ],
      lines: [
        { line_index: 1, units: 1, miles: 8, modifiers: ["76"], diagnosis_code: "z00", place_of_service: "99" },
        { line_index: 2, units: 1, miles: 7, modifiers: [] },
      ],
    });
    const out = applyResubmissionOverrides<Record<string, any>>({ ...basePayload }, snap);
    expect(out.trip_date).toBe("08/02/2026");
    expect(out.member_id).toBe("B7654321");
    expect(out.patient_number).toBe("B7654321");
    expect(out.miles).toBe(15);
    expect(out.pickup_odometer).toBe(10000);
    expect(out.dropoff_odometer).toBe(10015);
    expect(out.trip_units).toBe(2);
    expect(out.is_round_trip).toBe(true);
    expect(out.diagnosis_code).toBe("Z00");
    expect(out.place_of_service).toBe("99");
    expect(out.modifiers).toEqual(["76"]);
    expect(out.service_lines).toHaveLength(2);
    expect(out.is_resubmission).toBe(true);
  });

  it("honours an audited mileage override in the payload", () => {
    const snap = normalizeSnapshot({
      ...baseDraft(),
      miles_override: 30,
      miles_override_reason: "Mapped distance per HCPF denial letter",
    });
    const out = applyResubmissionOverrides<Record<string, any>>({ ...basePayload }, snap);
    expect(out.miles).toBe(30);
    expect(out.dropoff_odometer).toBe(1030);
  });
});

describe("draft lifecycle guards", () => {
  it("prevents a second active draft for the same denied claim", async () => {
    const { activeDraftConflict } = await import("@/lib/resubmissionDraft");
    expect(activeDraftConflict({ id: "a", status: "draft" }).blocked).toBe(true);
    expect(activeDraftConflict({ id: "a", status: "queued" }).blocked).toBe(true);
    expect(activeDraftConflict({ id: "a", status: "cancelled" }).blocked).toBe(false);
    expect(activeDraftConflict(null).blocked).toBe(false);
  });

  it("queues only on an explicit confirmation, once, and only when valid", async () => {
    const { canQueueDraft } = await import("@/lib/resubmissionDraft");
    const snap = baseDraft();
    expect(canQueueDraft({ status: "draft" }, snap, false).ok).toBe(false);
    expect(canQueueDraft({ status: "draft" }, snap, true).ok).toBe(true);
    // Ready to Submit is still editable; only a claimed copy is closed.
    expect(canQueueDraft({ status: "queued" }, snap, true).ok).toBe(true);
    expect(canQueueDraft({ status: "processing" }, snap, true).ok).toBe(false);
    expect(canQueueDraft({ status: "draft" }, { ...snap, medicaid_id: null }, true).ok).toBe(false);
  });
});
