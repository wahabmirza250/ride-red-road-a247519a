/**
 * Pure draft/validation/payload helpers for the driver self-created NEMT trip
 * flow. Kept free of React and Supabase so the rules can be unit-tested and so
 * the billing/PDF payload contract has one single source of truth.
 *
 * IMPORTANT: the payload shapes produced here must stay byte-compatible with
 * `createNemtTripGroup` (src/lib/nemtTrip.functions.ts) and
 * `generateStateFormPdf` (src/lib/medicaidPdf.ts).
 */

export type DraftRider = {
  id: string;
  full_name: string;
  medicaid_id: string;
  dob: string | null;
  phone: string | null;
  address: string | null;
};

export type DraftRiderSlot = {
  rider: DraftRider;
  identity_verified: boolean;
  signed_by_escort: boolean;
  signature_data_url: string | null;
  signer_name: string;
};

export type DraftLeg = {
  leg_index: 1 | 2;
  leg_date: string;
  pickup_time: string;
  pickup_odometer: string;
  pickup_address: string;
  dropoff_time: string;
  dropoff_odometer: string;
  dropoff_address: string;
};

export type TripKind = "one_way" | "round_trip" | "group_tour";

export type DriverTripDraft = {
  version: 2;
  updated_at: string;
  trip_kind: TripKind;
  vehicle_type: string;
  plate: string;
  vin: string;
  escort_name: string;
  driver_full_name: string;
  rider_slots: DraftRiderSlot[];
  legs: DraftLeg[];
  assigned_trip_id: string | null;
  /** Server-side in-progress trip row id, once the driver taps "Save trip". */
  server_draft_id: string | null;
};


export const DRAFT_VERSION = 2 as const;
export const DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
/** Rough localStorage safety cap; signatures are dropped first when exceeded. */
export const DRAFT_MAX_BYTES = 900_000;

export const STEPS = ["passenger", "trip", "details", "sign", "review"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  passenger: "Passenger",
  trip: "Trip",
  details: "Details",
  sign: "Signature",
  review: "Review",
};

export const today = () => new Date().toISOString().slice(0, 10);
export const nowHM = () => new Date().toTimeString().slice(0, 5);

export function emptyLeg(index: 1 | 2): DraftLeg {
  return {
    leg_index: index,
    leg_date: today(),
    pickup_time: index === 1 ? nowHM() : "",
    pickup_odometer: "",
    pickup_address: "",
    dropoff_time: "",
    dropoff_odometer: "",
    dropoff_address: "",
  };
}

export function createEmptyDraft(): DriverTripDraft {
  return {
    version: DRAFT_VERSION,
    updated_at: new Date().toISOString(),
    trip_kind: "one_way",
    vehicle_type: "",
    plate: "",
    vin: "",
    escort_name: "",
    driver_full_name: "",
    rider_slots: [],
    legs: [emptyLeg(1)],
    assigned_trip_id: null,
    server_draft_id: null,

  };
}

/** Draft is scoped per company AND per driver so nothing leaks across logins. */
export function draftStorageKey(companySlug: string | null | undefined, userId: string | null | undefined) {
  return `redart:driver-trip-draft:${companySlug ?? "_"}:${userId ?? "anon"}`;
}

export function isDraftEmpty(d: DriverTripDraft): boolean {
  if (d.rider_slots.length > 0) return false;
  if (d.plate.trim() || d.vin.trim() || d.escort_name.trim()) return false;
  return !d.legs.some((l) => l.pickup_address.trim() || l.dropoff_address.trim() || l.pickup_odometer || l.dropoff_odometer);
}

function stripSignatures(d: DriverTripDraft): DriverTripDraft {
  return { ...d, rider_slots: d.rider_slots.map((s) => ({ ...s, signature_data_url: null })) };
}

export type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function serializeDraft(draft: DriverTripDraft): string {
  const stamped = { ...draft, version: DRAFT_VERSION, updated_at: new Date().toISOString() };
  let json = JSON.stringify(stamped);
  if (json.length > DRAFT_MAX_BYTES) json = JSON.stringify(stripSignatures(stamped));
  return json;
}

export function saveDraft(storage: MinimalStorage, key: string, draft: DriverTripDraft): void {
  try {
    if (isDraftEmpty(draft)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, serializeDraft(draft));
  } catch {
    /* quota / private mode — drafts are best-effort */
  }
}

export function loadDraft(
  storage: MinimalStorage,
  key: string,
  now: number = Date.now(),
): DriverTripDraft | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = parsed as Partial<DriverTripDraft> | null;
  if (!d || typeof d !== "object") return null;
  if (d.version !== DRAFT_VERSION) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
  const stamp = d.updated_at ? Date.parse(d.updated_at) : NaN;
  if (!Number.isFinite(stamp) || now - stamp > DRAFT_TTL_MS) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
  const base = createEmptyDraft();
  const legs = Array.isArray(d.legs) && d.legs.length > 0 ? (d.legs as DraftLeg[]) : base.legs;
  return {
    ...base,
    ...d,
    version: DRAFT_VERSION,
    legs,
    rider_slots: Array.isArray(d.rider_slots) ? (d.rider_slots as DraftRiderSlot[]) : [],
  };
}

export function clearDraft(storage: MinimalStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ---------------- recent destinations (minimal typing helper) --------------- */

export const RECENT_ADDRESS_KEY = "redart:driver-recent-addresses";
export const MAX_RECENT_ADDRESSES = 6;

export function readRecentAddresses(storage: MinimalStorage): string[] {
  try {
    const raw = storage.getItem(RECENT_ADDRESS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentAddress(storage: MinimalStorage, address: string): string[] {
  const clean = address.trim();
  if (!clean) return readRecentAddresses(storage);
  const next = [clean, ...readRecentAddresses(storage).filter((a) => a !== clean)].slice(
    0,
    MAX_RECENT_ADDRESSES,
  );
  try {
    storage.setItem(RECENT_ADDRESS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/* ------------------------------ odometers --------------------------------- */

/**
 * Odometer readings are MANDATORY on every leg of every NEMT trip: they drive
 * the billed mileage on the state form. Accepts plain digits with an optional
 * single decimal (e.g. "123456" or "123456.4"). Returns null when invalid.
 */
export function parseOdometer(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/,/g, "");
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return null;
  return n;
}

/** Mileage for one leg, or null when either reading is missing/invalid/backwards. */
export function legMiles(leg: Pick<DraftLeg, "pickup_odometer" | "dropoff_odometer">): number | null {
  const p = parseOdometer(leg.pickup_odometer);
  const dOff = parseOdometer(leg.dropoff_odometer);
  if (p === null || dOff === null || dOff < p) return null;
  return Number((dOff - p).toFixed(1));
}

/** Total billable miles across legs, or null if any leg is invalid. */
export function totalMiles(d: DriverTripDraft): number | null {
  let sum = 0;
  for (const l of d.legs) {
    const m = legMiles(l);
    if (m === null) return null;
    sum += m;
  }
  return Number(sum.toFixed(1));
}

/* ------------------------------ validation -------------------------------- */

export type FieldIssues = Record<string, string>;


export function validatePassengerStep(d: DriverTripDraft): FieldIssues {
  const issues: FieldIssues = {};
  if (d.rider_slots.length === 0) issues["riders"] = "Add at least one passenger";
  if (d.trip_kind !== "group_tour" && d.rider_slots.length > 1) {
    issues["riders"] = "Switch to Group tour to keep more than one passenger";
  }
  return issues;
}

export function validateTripStep(d: DriverTripDraft): FieldIssues {
  const issues: FieldIssues = {};
  d.legs.forEach((l, i) => {
    const p = `leg${i}`;
    if (!l.leg_date) issues[`${p}.leg_date`] = "Pick the trip date";
    if (!l.pickup_address.trim()) issues[`${p}.pickup_address`] = "Pickup address is required";
    if (!l.dropoff_address.trim()) issues[`${p}.dropoff_address`] = "Drop-off address is required";
    for (const field of ["pickup_odometer", "dropoff_odometer"] as const) {
      const label = field === "pickup_odometer" ? "Pickup" : "Drop-off";
      const raw = String(l[field] ?? "").trim();
      if (!raw) issues[`${p}.${field}`] = `${label} odometer is required`;
      else if (parseOdometer(raw) === null)
        issues[`${p}.${field}`] = `${label} odometer must be a whole number of miles`;
    }
    const pk = parseOdometer(l.pickup_odometer);
    const dp = parseOdometer(l.dropoff_odometer);
    if (pk !== null && dp !== null && dp < pk) {
      issues[`${p}.dropoff_odometer`] =
        "Drop-off odometer must be greater than or equal to pickup (mileage cannot be negative)";
    }

  });
  return issues;
}

export function validateDetailsStep(d: DriverTripDraft): FieldIssues {
  const issues: FieldIssues = {};
  if (!d.vehicle_type) issues["vehicle_type"] = "Select the vehicle type";
  if (!d.plate.trim()) issues["plate"] = "License plate is required";
  return issues;
}

export function validateSignStep(d: DriverTripDraft): FieldIssues {
  const issues: FieldIssues = {};
  d.rider_slots.forEach((s) => {
    if (!s.signature_data_url) issues[`sig.${s.rider.id}`] = `${s.rider.full_name} still needs to sign`;
    else if (!s.signer_name.trim()) issues[`name.${s.rider.id}`] = "Enter who signed";
  });
  if (d.rider_slots.length === 0) issues["riders"] = "Add at least one passenger";
  return issues;
}

/* ------------------- stage 1: start / save an in-progress trip ------------- */

/**
 * Fields that genuinely exist when the driver STARTS the trip. Drop-off
 * odometer/time and signatures are deliberately NOT required here — that data
 * does not exist yet in the field.
 */
export function validateTripStartStep(d: DriverTripDraft): FieldIssues {
  const issues: FieldIssues = {};
  const l = d.legs[0];
  if (!l) return { "leg0.pickup_address": "Pickup address is required" };
  if (!l.leg_date) issues["leg0.leg_date"] = "Pick the trip date";
  if (!l.pickup_time.trim()) issues["leg0.pickup_time"] = "Pickup time is required";
  if (!l.pickup_address.trim()) issues["leg0.pickup_address"] = "Pickup address is required";
  if (!l.dropoff_address.trim()) issues["leg0.dropoff_address"] = "Destination is required";
  const raw = String(l.pickup_odometer ?? "").trim();
  if (!raw) issues["leg0.pickup_odometer"] = "Pickup odometer is required at trip start";
  else if (parseOdometer(raw) === null)
    issues["leg0.pickup_odometer"] = "Pickup odometer must be a whole number of miles";
  return issues;
}

/** Everything needed before an in-progress trip may be saved to the server. */
export function validateSaveStage(d: DriverTripDraft): FieldIssues {
  return {
    ...validatePassengerStep(d),
    ...validateTripStartStep(d),
    ...validateDetailsStep(d),
  };
}

export function isDraftSavable(d: DriverTripDraft): boolean {
  return Object.keys(validateSaveStage(d)).length === 0;
}

/** Human-readable list of what still blocks final submission to billing. */
export function missingForCompletion(d: DriverTripDraft): string[] {
  const missing: string[] = [];
  d.legs.forEach((l, i) => {
    const legName = d.legs.length > 1 ? (i === 0 ? "Outbound" : "Return") : "Trip";
    if (!l.pickup_address.trim()) missing.push(`${legName}: pickup address`);
    if (!l.dropoff_address.trim()) missing.push(`${legName}: drop-off address`);
    if (parseOdometer(l.pickup_odometer) === null) missing.push(`${legName}: pickup odometer`);
    if (parseOdometer(l.dropoff_odometer) === null) missing.push(`${legName}: drop-off odometer`);
    else if (legMiles(l) === null) missing.push(`${legName}: drop-off odometer is lower than pickup`);
    if (!l.dropoff_time.trim()) missing.push(`${legName}: drop-off time`);
  });
  if (!d.vehicle_type) missing.push("Vehicle type");
  if (!d.plate.trim()) missing.push("License plate");
  if (d.rider_slots.length === 0) missing.push("Passenger");
  d.rider_slots.forEach((s) => {
    if (!s.signature_data_url) missing.push(`Signature from ${s.rider.full_name}`);
    else if (!s.signer_name.trim()) missing.push(`Signer name for ${s.rider.full_name}`);
  });
  return missing;
}

/** Label for the resume list on the driver dashboard/history. */
export function draftStatusLabel(d: DriverTripDraft): "Ready to submit" | "Needs completion" {
  return isDraftSubmittable(d) ? "Ready to submit" : "Needs completion";
}

/** Short summary used as the saved-trip title. */
export function draftLabel(d: DriverTripDraft): string {
  const who = d.rider_slots[0]?.rider.full_name ?? "Unnamed passenger";
  const l = d.legs[0];
  const where = l?.dropoff_address ? ` → ${l.dropoff_address}` : "";
  return `${who}${where}`.slice(0, 160);
}


export function validateStep(step: Step, d: DriverTripDraft): FieldIssues {
  switch (step) {
    case "passenger":
      return validatePassengerStep(d);
    case "trip":
      return validateTripStep(d);
    case "details":
      return validateDetailsStep(d);
    case "sign":
      return validateSignStep(d);
    case "review":
      return {
        ...validatePassengerStep(d),
        ...validateTripStep(d),
        ...validateDetailsStep(d),
        ...validateSignStep(d),
      };
  }
}

/**
 * Wizard navigation rules. Only data that exists at that moment in the field is
 * required to move forward; completion data (drop-off odometer/time,
 * signatures) is enforced by `validateStep("review", …)` at final submit.
 */
export function validateStepForNavigation(step: Step, d: DriverTripDraft): FieldIssues {
  switch (step) {
    case "trip":
      return validateTripStartStep(d);
    case "sign":
      return {};
    default:
      return validateStep(step, d);
  }
}

export function firstIssue(issues: FieldIssues): string | null {

  const values = Object.values(issues);
  return values.length > 0 ? values[0] : null;
}

export function isDraftSubmittable(d: DriverTripDraft): boolean {
  return Object.keys(validateStep("review", d)).length === 0;
}

/** Steps that are complete (used for the progress indicator). */
export function completedSteps(d: DriverTripDraft): Record<Step, boolean> {
  return {
    passenger: Object.keys(validatePassengerStep(d)).length === 0,
    trip: Object.keys(validateTripStep(d)).length === 0,
    details: Object.keys(validateDetailsStep(d)).length === 0,
    sign: Object.keys(validateSignStep(d)).length === 0,
    review: isDraftSubmittable(d),
  };
}

/* ----------------------- billing / PDF payload builders -------------------- */

export type LegPayload = {
  leg_index: 1 | 2;
  leg_date: string;
  pickup_time: string | null;
  pickup_odometer: number;
  pickup_address: string;
  dropoff_time: string | null;
  dropoff_odometer: number;
  dropoff_address: string;
};

export function buildLegsPayload(d: DriverTripDraft): LegPayload[] {
  return d.legs.map((l, i) => {
    const pickup = parseOdometer(l.pickup_odometer);
    const dropoff = parseOdometer(l.dropoff_odometer);
    // Hard guard: odometers are a mandatory part of the state billing record.
    if (pickup === null || dropoff === null || dropoff < pickup) {
      throw new Error(
        `Leg ${i + 1}: pickup and drop-off odometer readings are required and drop-off cannot be lower than pickup.`,
      );
    }
    return {
      leg_index: l.leg_index,
      leg_date: l.leg_date,
      pickup_time: l.pickup_time || null,
      pickup_odometer: pickup,
      pickup_address: l.pickup_address,
      dropoff_time: l.dropoff_time || null,
      dropoff_odometer: dropoff,
      dropoff_address: l.dropoff_address,
    };
  });
}


/** Exact input for `createNemtTripGroup`. */
export function buildCreateTripPayload(d: DriverTripDraft) {
  return {
    trip_kind: d.trip_kind,
    vehicle_type: d.vehicle_type,
    vehicle_plate: d.plate,
    vehicle_vin: d.vin || null,
    escort_name: d.escort_name || null,
    riders: d.rider_slots.map((s) => ({
      rider_id: s.rider.id,
      identity_verified: s.identity_verified,
      signed_by_escort: s.signed_by_escort,
    })),
    legs: buildLegsPayload(d),
  };
}

/** Exact input for `generateStateFormPdf` for one rider slot. */
export function buildPdfArgs(
  d: DriverTripDraft,
  slot: DraftRiderSlot,
  opts: { driverName: string; riderOverride?: DraftRider },
) {
  return {
    rider: opts.riderOverride ?? slot.rider,
    driverName: opts.driverName,
    vehiclePlate: d.plate,
    vehicleVin: d.vin || null,
    vehicleType: d.vehicle_type,
    escortName: d.escort_name || null,
    identityVerified: slot.identity_verified,
    tripKind: d.trip_kind,
    legs: buildLegsPayload(d),
    signatureName: slot.signer_name,
    signatureUrl: slot.signature_data_url,
    signedByEscort: slot.signed_by_escort,
  };
}

/* --------------------------- draft mutation helpers ------------------------ */

export function withTripKind(d: DriverTripDraft, kind: TripKind): DriverTripDraft {
  let legs = d.legs;
  if (kind === "round_trip" && legs.length === 1) {
    const first = legs[0];
    legs = [
      first,
      {
        ...emptyLeg(2),
        leg_date: first.leg_date,
        pickup_address: first.dropoff_address,
        dropoff_address: first.pickup_address,
      },
    ];
  } else if (kind !== "round_trip" && legs.length > 1) {
    legs = [legs[0]];
  }
  const rider_slots =
    kind !== "group_tour" && d.rider_slots.length > 1 ? d.rider_slots.slice(0, 1) : d.rider_slots;
  return { ...d, trip_kind: kind, legs, rider_slots };
}

export function addRiderSlot(d: DriverTripDraft, rider: DraftRider): DriverTripDraft {
  if (d.rider_slots.some((s) => s.rider.id === rider.id)) return d;
  if (d.trip_kind !== "group_tour" && d.rider_slots.length >= 1) return d;
  return {
    ...d,
    rider_slots: [
      ...d.rider_slots,
      {
        rider,
        identity_verified: true,
        signed_by_escort: false,
        signature_data_url: null,
        signer_name: rider.full_name,
      },
    ],
  };
}

export function removeRiderSlot(d: DriverTripDraft, riderId: string): DriverTripDraft {
  return { ...d, rider_slots: d.rider_slots.filter((s) => s.rider.id !== riderId) };
}

export function updateLeg(d: DriverTripDraft, index: number, patch: Partial<DraftLeg>): DriverTripDraft {
  return { ...d, legs: d.legs.map((l, i) => (i === index ? { ...l, ...patch } : l)) };
}

export function updateSlot(
  d: DriverTripDraft,
  riderId: string,
  patch: Partial<DraftRiderSlot>,
): DriverTripDraft {
  return {
    ...d,
    rider_slots: d.rider_slots.map((s) => (s.rider.id === riderId ? { ...s, ...patch } : s)),
  };
}
