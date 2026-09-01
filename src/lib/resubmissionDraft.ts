/**
 * RESUBMISSION DRAFT MODEL (pure, shared by server, UI and tests).
 *
 * A resubmission draft is a COMPLETE editable copy of the original claim.
 * Nothing in this module ever writes to medicaid_trips, medicaid_trip_legs or
 * billing_records: the corrected values live only in
 * claim_resubmissions.draft_snapshot and the draft's claim_service_lines.
 *
 * The original snapshot is captured once, at draft creation, so the audit view
 * can always show Original -> Corrected even years later.
 */

export const MAX_MODIFIERS = 4;

export type DraftLeg = {
  leg_index: number;
  leg_date: string | null; // yyyy-mm-dd
  pickup_time: string | null; // HH:MM
  pickup_address: string;
  pickup_odometer: number | null;
  dropoff_time: string | null;
  dropoff_address: string;
  dropoff_odometer: number | null;
};

export type DraftServiceLine = {
  line_index: number;
  service_date: string | null;
  procedure_code: string | null;
  place_of_service: string | null;
  diagnosis_code: string | null;
  units: number | null;
  miles: number | null;
  amount: number | null;
  modifiers: string[];
};

export type DraftSnapshot = {
  service_date: string | null; // yyyy-mm-dd
  rider_id: string | null;
  passenger_name: string | null;
  medicaid_id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  vehicle_vin: string | null;
  trip_kind: string | null; // one_way | round_trip
  escort_name: string | null;
  identity_verified: boolean;
  signed_by_escort: boolean;
  signature_on_file: boolean;
  state_pdf_path: string | null;
  miles_override: number | null;
  miles_override_reason: string | null;
  correction_reason: string | null;
  legs: DraftLeg[];
  lines: DraftServiceLine[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s : null;
};

export const dateOnly = (v: unknown): string | null => {
  const s = text(v);
  return s ? s.slice(0, 10) : null;
};

export const timeOnly = (v: unknown): string | null => {
  const s = text(v);
  return s ? s.slice(0, 5) : null;
};

/** A custom modifier is exactly two alphanumeric characters, uppercase. */
export function normalizeModifier(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}

export function isValidModifier(code: string): boolean {
  return /^[A-Z0-9]{2}$/.test(normalizeModifier(code));
}

export function normalizeModifiers(list: unknown): string[] {
  const arr = Array.isArray(list) ? list : [];
  return [...new Set(arr.map((m) => normalizeModifier(String(m))).filter(Boolean))].slice(
    0,
    MAX_MODIFIERS,
  );
}

export function legMilesOf(leg: Pick<DraftLeg, "pickup_odometer" | "dropoff_odometer">): number {
  const a = num(leg.pickup_odometer);
  const b = num(leg.dropoff_odometer);
  if (a == null || b == null) return 0;
  return Math.max(0, Math.round((b - a) * 10) / 10);
}

/** Billed miles are the SUM of per-leg odometer deltas, never the raw span. */
export function odometerMiles(legs: DraftLeg[]): number {
  return Math.round(legs.reduce((sum, l) => sum + legMilesOf(l), 0) * 10) / 10;
}

/** Miles actually billed: the odometer total unless an audited override exists. */
export function effectiveMiles(snap: DraftSnapshot): number {
  const override = num(snap.miles_override);
  if (override != null && text(snap.miles_override_reason)) return override;
  return odometerMiles(snap.legs ?? []);
}

export function normalizeLeg(raw: any, index: number): DraftLeg {
  return {
    leg_index: Number(raw?.leg_index ?? index + 1),
    leg_date: dateOnly(raw?.leg_date),
    pickup_time: timeOnly(raw?.pickup_time),
    pickup_address: text(raw?.pickup_address) ?? "",
    pickup_odometer: num(raw?.pickup_odometer),
    dropoff_time: timeOnly(raw?.dropoff_time),
    dropoff_address: text(raw?.dropoff_address) ?? "",
    dropoff_odometer: num(raw?.dropoff_odometer),
  };
}

export function normalizeLine(raw: any, index: number): DraftServiceLine {
  return {
    line_index: Number(raw?.line_index ?? index + 1),
    service_date: dateOnly(raw?.service_date),
    procedure_code: text(raw?.procedure_code)?.toUpperCase() ?? null,
    place_of_service: text(raw?.place_of_service),
    diagnosis_code: text(raw?.diagnosis_code)?.toUpperCase() ?? null,
    units: num(raw?.units),
    miles: num(raw?.miles),
    amount: num(raw?.amount),
    modifiers: normalizeModifiers(raw?.modifiers),
  };
}

export function normalizeSnapshot(raw: any): DraftSnapshot {
  const legs = (Array.isArray(raw?.legs) ? raw.legs : []).map(normalizeLeg);
  const lines = (Array.isArray(raw?.lines) ? raw.lines : []).map(normalizeLine);
  return {
    service_date: dateOnly(raw?.service_date),
    rider_id: text(raw?.rider_id),
    passenger_name: text(raw?.passenger_name),
    medicaid_id: text(raw?.medicaid_id)?.toUpperCase() ?? null,
    driver_id: text(raw?.driver_id),
    driver_name: text(raw?.driver_name),
    vehicle_type: text(raw?.vehicle_type),
    vehicle_plate: text(raw?.vehicle_plate)?.toUpperCase() ?? null,
    vehicle_vin: text(raw?.vehicle_vin)?.toUpperCase() ?? null,
    trip_kind: text(raw?.trip_kind) ?? (legs.length >= 2 ? "round_trip" : "one_way"),
    escort_name: text(raw?.escort_name),
    identity_verified: raw?.identity_verified !== false,
    signed_by_escort: raw?.signed_by_escort === true,
    signature_on_file: raw?.signature_on_file !== false,
    state_pdf_path: text(raw?.state_pdf_path),
    miles_override: num(raw?.miles_override),
    miles_override_reason: text(raw?.miles_override_reason),
    correction_reason: text(raw?.correction_reason),
    legs,
    lines,
  };
}

/** Build the initial snapshot from the ORIGINAL trip + legs + seeded lines. */
export function buildSnapshotFromTrip(args: {
  trip: any;
  legs: any[];
  lines?: any[];
  rider?: any;
  driverName?: string | null;
}): DraftSnapshot {
  const { trip, rider } = args;
  const serviceDate = dateOnly(trip?.pickup_at);
  const legs = (args.legs ?? []).map((l, i) => ({
    ...normalizeLeg(l, i),
    leg_date: dateOnly(l?.leg_date) ?? serviceDate,
    pickup_address: text(l?.pickup_address) ?? text(trip?.pickup_address) ?? "",
    dropoff_address: text(l?.dropoff_address) ?? text(trip?.dropoff_address) ?? "",
  }));
  const fallbackLegs: DraftLeg[] = legs.length
    ? legs
    : [
        normalizeLeg(
          {
            leg_index: 1,
            leg_date: serviceDate,
            pickup_address: trip?.pickup_address,
            dropoff_address: trip?.dropoff_address,
            pickup_odometer: trip?.odometer_start,
            dropoff_odometer: trip?.odometer_end,
          },
          0,
        ),
      ];
  const lines = (args.lines ?? []).map(normalizeLine);
  return normalizeSnapshot({
    service_date: serviceDate,
    rider_id: trip?.rider_id ?? null,
    passenger_name: rider?.full_name ?? null,
    medicaid_id: rider?.medicaid_id ?? null,
    driver_id: trip?.driver_id ?? null,
    driver_name: args.driverName ?? trip?.paper_driver_name ?? null,
    vehicle_type: trip?.vehicle_type ?? null,
    vehicle_plate: trip?.vehicle_plate ?? null,
    vehicle_vin: trip?.vehicle_vin ?? null,
    trip_kind: trip?.trip_kind ?? (fallbackLegs.length >= 2 ? "round_trip" : "one_way"),
    escort_name: trip?.escort_name ?? null,
    identity_verified: trip?.identity_verified !== false,
    signed_by_escort: trip?.signed_by_escort === true,
    signature_on_file: Boolean(trip?.signature_path || trip?.state_pdf_path),
    state_pdf_path: trip?.state_pdf_path ?? null,
    miles_override: null,
    miles_override_reason: null,
    correction_reason: null,
    legs: fallbackLegs,
    lines,
  });
}

export type DraftIssue = { field: string; message: string };

/** Full pre-queue validation. Saving a draft never runs this as a blocker. */
export function validateDraft(rawSnap: DraftSnapshot): { ok: boolean; issues: DraftIssue[] } {
  const snap = normalizeSnapshot(rawSnap);
  const issues: DraftIssue[] = [];
  const push = (field: string, message: string) => issues.push({ field, message });

  if (!snap.service_date) push("service_date", "Service date is required.");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(snap.service_date))
    push("service_date", "Service date must be a real calendar date.");
  if (!snap.medicaid_id) push("medicaid_id", "Medicaid member ID is required.");
  if (!snap.driver_id && !snap.driver_name) push("driver", "A driver is required.");
  if (!snap.vehicle_type) push("vehicle_type", "Vehicle type is required.");

  if (!snap.legs.length) push("legs", "At least one trip leg is required.");
  const wantLegs = snap.trip_kind === "round_trip" ? 2 : 1;
  if (snap.legs.length < wantLegs)
    push(
      "legs",
      `A ${snap.trip_kind === "round_trip" ? "round trip" : "one-way trip"} needs ${wantLegs} leg${wantLegs > 1 ? "s" : ""}.`,
    );

  snap.legs.forEach((leg, i) => {
    const at = `legs.${i}`;
    if (!leg.leg_date) push(`${at}.leg_date`, `Leg ${i + 1}: pickup date is required.`);
    if (!leg.pickup_time) push(`${at}.pickup_time`, `Leg ${i + 1}: pickup time is required.`);
    if (!leg.dropoff_time) push(`${at}.dropoff_time`, `Leg ${i + 1}: drop-off time is required.`);
    if (!leg.pickup_address) push(`${at}.pickup_address`, `Leg ${i + 1}: pickup address is required.`);
    if (!leg.dropoff_address)
      push(`${at}.dropoff_address`, `Leg ${i + 1}: drop-off address is required.`);
    if (leg.pickup_odometer == null)
      push(`${at}.pickup_odometer`, `Leg ${i + 1}: pickup odometer is required.`);
    if (leg.dropoff_odometer == null)
      push(`${at}.dropoff_odometer`, `Leg ${i + 1}: drop-off odometer is required.`);
    if (leg.pickup_odometer != null && leg.pickup_odometer < 0)
      push(`${at}.pickup_odometer`, `Leg ${i + 1}: odometer cannot be negative.`);
    if (
      leg.pickup_odometer != null &&
      leg.dropoff_odometer != null &&
      leg.dropoff_odometer < leg.pickup_odometer
    )
      push(
        `${at}.dropoff_odometer`,
        `Leg ${i + 1}: drop-off odometer must be greater than or equal to the pickup odometer.`,
      );
  });

  const computed = odometerMiles(snap.legs);
  if (snap.miles_override != null) {
    if (snap.miles_override < 0) push("miles_override", "Mileage override cannot be negative.");
    if (!snap.miles_override_reason)
      push(
        "miles_override_reason",
        "A mileage override needs a written reason — it is recorded in the audit trail.",
      );
  } else if (computed <= 0) {
    push("legs", "Odometer readings give 0 billable miles.");
  }

  if (!snap.lines.length) push("lines", "At least one service line is required.");
  snap.lines.forEach((line, i) => {
    const at = `lines.${i}`;
    if (line.units != null && line.units < 0) push(`${at}.units`, `Line ${i + 1}: units cannot be negative.`);
    if (line.miles != null && line.miles < 0) push(`${at}.miles`, `Line ${i + 1}: miles cannot be negative.`);
    if (line.amount != null && line.amount < 0)
      push(`${at}.amount`, `Line ${i + 1}: amount cannot be negative.`);
    if (line.modifiers.length > MAX_MODIFIERS)
      push(`${at}.modifiers`, `Line ${i + 1}: at most ${MAX_MODIFIERS} modifiers.`);
    for (const m of line.modifiers)
      if (!isValidModifier(m))
        push(`${at}.modifiers`, `Line ${i + 1}: "${m}" is not a valid two-character modifier.`);
  });

  const totalUnits = snap.lines.reduce((s, l) => s + (l.units ?? 0), 0);
  if (snap.trip_kind === "round_trip" && totalUnits < 2)
    push("lines", "A round trip must bill at least 2 units across its service lines.");

  return { ok: issues.length === 0, issues };
}

export type DiffValue = string | number | boolean | null;
export type FieldChange = { field: string; label: string; before: DiffValue; after: DiffValue };

/** Diff values are always plain scalars so they serialize across the RPC boundary. */
export function diffValue(v: unknown): DiffValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : null;
  return JSON.stringify(v);
}

const LABELS: Record<string, string> = {
  service_date: "Service date",
  passenger_name: "Passenger",
  medicaid_id: "Medicaid ID",
  driver_name: "Driver",
  vehicle_type: "Vehicle type",
  vehicle_plate: "Plate",
  vehicle_vin: "VIN",
  trip_kind: "Trip kind",
  escort_name: "Escort",
  identity_verified: "Identity verified",
  signed_by_escort: "Signed by escort",
  signature_on_file: "Signature on file",
  state_pdf_path: "Supporting attachment",
  miles_override: "Mileage override",
  miles_override_reason: "Mileage override reason",
  correction_reason: "Correction reason",
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Field-level Original -> Corrected diff, used by the review screen + audit. */
export function diffSnapshots(originalRaw: any, draftRaw: any): FieldChange[] {
  const a = normalizeSnapshot(originalRaw ?? {});
  const b = normalizeSnapshot(draftRaw ?? {});
  const out: FieldChange[] = [];

  for (const key of Object.keys(LABELS) as (keyof DraftSnapshot)[]) {
    if (!same(a[key], b[key]))
      out.push({
        field: String(key),
        label: LABELS[String(key)]!,
        before: diffValue(a[key]),
        after: diffValue(b[key]),
      });
  }

  const maxLegs = Math.max(a.legs.length, b.legs.length);
  for (let i = 0; i < maxLegs; i++) {
    const la = a.legs[i];
    const lb = b.legs[i];
    if (!la || !lb) {
      out.push({
        field: `legs.${i}`,
        label: `Leg ${i + 1}`,
        before: diffValue(la ?? null),
        after: diffValue(lb ?? null),
      });
      continue;
    }
    for (const k of [
      "leg_date",
      "pickup_time",
      "pickup_address",
      "pickup_odometer",
      "dropoff_time",
      "dropoff_address",
      "dropoff_odometer",
    ] as (keyof DraftLeg)[]) {
      if (!same(la[k], lb[k]))
        out.push({
          field: `legs.${i}.${String(k)}`,
          label: `Leg ${i + 1} · ${String(k).replace(/_/g, " ")}`,
          before: diffValue(la[k]),
          after: diffValue(lb[k]),
        });
    }
    if (legMilesOf(la) !== legMilesOf(lb))
      out.push({
        field: `legs.${i}.miles`,
        label: `Leg ${i + 1} · miles`,
        before: legMilesOf(la),
        after: legMilesOf(lb),
      });
  }

  const maxLines = Math.max(a.lines.length, b.lines.length);
  for (let i = 0; i < maxLines; i++) {
    const sa = a.lines[i];
    const sb = b.lines[i];
    if (!sa || !sb) {
      out.push({
        field: `lines.${i}`,
        label: `Service line ${i + 1}`,
        before: diffValue(sa ?? null),
        after: diffValue(sb ?? null),
      });
      continue;
    }
    for (const k of [
      "service_date",
      "procedure_code",
      "place_of_service",
      "diagnosis_code",
      "units",
      "miles",
      "amount",
      "modifiers",
    ] as (keyof DraftServiceLine)[]) {
      if (!same(sa[k], sb[k]))
        out.push({
          field: `lines.${i}.${String(k)}`,
          label: `Service line ${i + 1} · ${String(k).replace(/_/g, " ")}`,
          before: diffValue(sa[k]),
          after: diffValue(sb[k]),
        });
    }
  }

  const ma = odometerMiles(a.legs);
  const mb = odometerMiles(b.legs);
  if (ma !== mb)
    out.push({ field: "total_miles", label: "Total miles", before: ma, after: mb });

  return out;
}

/**
 * Overlay a saved corrected draft onto an otherwise-normal robot payload.
 * First-time submissions never call this, so their behaviour is unchanged.
 */
export function applyResubmissionOverrides<T extends Record<string, any>>(
  payload: T,
  snapRaw: any,
  opts: { serviceDateMDY?: (isoDate: string) => string } = {},
): T {
  if (!snapRaw) return payload;
  const snap = normalizeSnapshot(snapRaw);
  const out: Record<string, any> = { ...payload };

  const toMdy =
    opts.serviceDateMDY ??
    ((iso: string) => {
      const [y, m, d] = iso.split("-");
      return y && m && d ? `${m}/${d}/${y}` : iso;
    });

  if (snap.service_date) {
    const mdy = toMdy(snap.service_date);
    for (const k of ["trip_date", "service_date", "date_of_service", "from_date", "to_date"])
      out[k] = mdy;
  }
  if (snap.medicaid_id) {
    for (const k of [
      "medicaid_member_id",
      "member_id",
      "medicaid_id",
      "patient_number",
      "patient_account_number",
    ])
      out[k] = snap.medicaid_id;
  }
  if (snap.vehicle_type) out.vehicle_type = snap.vehicle_type;
  if (snap.vehicle_plate) out.vehicle_plate = snap.vehicle_plate;
  if (snap.vehicle_vin) out.vehicle_vin = snap.vehicle_vin;
  if (snap.driver_name) out.driver_name = snap.driver_name;
  if (snap.escort_name) out.escort_name = snap.escort_name;

  const legs = snap.legs.map((l) => ({
    pickup_odometer: Number(l.pickup_odometer ?? 0),
    dropoff_odometer: Number(l.dropoff_odometer ?? 0),
  }));
  if (legs.length) {
    const miles = effectiveMiles(snap);
    const start = Number(legs[0]?.pickup_odometer ?? 0);
    out.odometer_legs = legs;
    out.pickup_odometer = start;
    out.dropoff_odometer = Math.round((start + miles) * 10) / 10;
    out.miles = miles;
    out.mileage_units = miles;
    out.total_miles = miles;
  }

  const isRound = snap.trip_kind === "round_trip";
  out.is_round_trip = isRound;
  const units = snap.lines.reduce((s, l) => s + (l.units ?? 0), 0) || (isRound ? 2 : 1);
  out.trip_units = units;
  out.units = units;
  out.trip_unit_count = units;
  out.base_units = units;

  const dx = snap.lines.find((l) => l.diagnosis_code)?.diagnosis_code ?? null;
  if (dx) {
    for (const k of [
      "diagnosis_code",
      "diagnosis",
      "primary_diagnosis",
      "primary_diagnosis_code",
      "dx_code",
      "icd_code",
      "icd10_code",
    ])
      out[k] = dx;
    out.diagnosis_codes = [dx];
  }
  const pos = snap.lines.find((l) => l.place_of_service)?.place_of_service ?? null;
  if (pos) out.place_of_service = pos;

  out.service_lines = snap.lines.map((l) =>
    withPortalMoneyFields(
      {
        line_index: l.line_index,
        service_date: l.service_date ? toMdy(l.service_date) : null,
        procedure_code: l.procedure_code,
        place_of_service: l.place_of_service,
        diagnosis_code: l.diagnosis_code,
        units: l.units,
        miles: l.miles,
        // Exact currency text: a float artifact such as 54.800000000000004 is
        // rejected by the portal's Charge Amount box.
        amount: l.amount,
        charge_amount: l.amount,
        modifiers: l.modifiers,
      },
      ["amount", "charge_amount"],
    ),
  );
  out.modifiers = [...new Set(snap.lines.flatMap((l) => l.modifiers))];
  out.is_resubmission = true;

  // Every money field the robot may type, as exact two-decimal text.
  const lineTotal = snap.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  out.total_charge = portalMoneyString(lineTotal) ?? out.total_charge;
  for (const k of PORTAL_MONEY_KEYS) {
    if (!(k in out)) continue;
    const s = portalMoneyString(out[k]);
    if (s !== null) out[k] = s;
  }

  return out as T;
}

/** Only ONE live draft may exist per denied claim (also enforced by a DB index). */
export function activeDraftConflict(
  existing: { id: string; status: string } | null | undefined,
): { blocked: boolean; id: string | null; reason: string } {
  if (existing && (existing.status === "draft" || existing.status === "queued"))
    return {
      blocked: true,
      id: existing.id,
      reason: "This denied claim already has an active resubmission draft.",
    };
  return { blocked: false, id: null, reason: "" };
}

/** Queueing is explicit, idempotent and only ever valid from a draft. */
export function canQueueDraft(
  sub: { status?: string | null } | null | undefined,
  snapshot: any,
  confirmed: boolean,
): { ok: boolean; reason: string } {
  if (!confirmed)
    return { ok: false, reason: "Queueing needs an explicit confirmation from the biller." };
  if (sub?.status !== "draft" && sub?.status !== "queued")
    return { ok: false, reason: `This corrected claim is already ${sub?.status ?? "gone"}.` };
  const validation = validateDraft(normalizeSnapshot(snapshot ?? {}));
  if (!validation.ok)
    return { ok: false, reason: validation.issues[0]?.message ?? "The corrected claim is not valid yet." };
  return { ok: true, reason: "" };
}
