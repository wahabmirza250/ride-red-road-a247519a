/**
 * LIVE BILLING CALCULATOR for the denied-claim resubmission editor.
 *
 * Pure module — no I/O, no Supabase, no React. The editor bar, the Review tab,
 * the service-line consistency check and the queued payload all use these same
 * functions so the number the biller sees is the number that gets billed.
 *
 * Rates are NEVER hard-coded: every charge comes from company-scoped
 * public.billing_rate_settings rows handed in by the server.
 */

import {
  effectiveMiles,
  legMilesOf,
  odometerMiles,
  type DraftLeg,
  type DraftServiceLine,
  type DraftSnapshot,
} from "@/lib/resubmissionDraft";

export type RateSetting = {
  id?: string;
  provider_id?: string | null;
  vehicle_type: string;
  unit_type: string; // "trip" | "mile"
  procedure_code: string;
  charge_amount: number | string;
  place_of_service?: string | null;
  default_diagnosis_code?: string | null;
};

export type ResolvedRate = {
  unit_type: "trip" | "mile";
  procedure_code: string;
  rate: number;
  place_of_service: string | null;
  diagnosis_code: string | null;
};

export type BillingLine = {
  kind: "trip" | "mile";
  label: string;
  procedure_code: string;
  quantity: number;
  rate: number;
  amount: number;
  breakdown: string;
};

export type BillingWarning = { code: string; message: string };

export type DraftBilling = {
  vehicle_type: string | null;
  units: number;
  miles: number;
  miles_source: "odometer" | "override";
  valid_legs: number;
  trip_rate: ResolvedRate | null;
  mile_rate: ResolvedRate | null;
  missing_rates: ("trip" | "mile")[];
  lines: BillingLine[];
  base_charge: number | null;
  mileage_charge: number | null;
  /** Extra draft lines that are neither the configured trip nor mileage line. */
  extra_charge: number;
  extra_lines: DraftServiceLine[];
  total: number | null;
  warnings: BillingWarning[];
};

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return `$${round2(Number(n)).toFixed(2)}`;
}

/** A leg is billable when both odometers are present and the delta is >= 0. */
export function isBillableLeg(leg: DraftLeg): boolean {
  const a = leg.pickup_odometer;
  const b = leg.dropoff_odometer;
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && b >= a;
}

export function invalidLegIndexes(legs: DraftLeg[]): number[] {
  return legs
    .map((l, i) => (isBillableLeg(l) ? -1 : i))
    .filter((i) => i >= 0);
}

/**
 * Resolve one rate for the draft's vehicle type from company-scoped settings.
 * Prefers a row matching the given provider, then any row for that vehicle.
 */
export function resolveRate(
  rates: RateSetting[],
  vehicleType: string | null | undefined,
  unitType: "trip" | "mile",
  providerId?: string | null,
): ResolvedRate | null {
  if (!vehicleType) return null;
  const candidates = (rates ?? []).filter(
    (r) =>
      String(r.vehicle_type) === String(vehicleType) && String(r.unit_type) === unitType,
  );
  if (!candidates.length) return null;
  const picked =
    (providerId ? candidates.find((r) => r.provider_id === providerId) : null) ?? candidates[0]!;
  const rate = Number(picked.charge_amount);
  if (!Number.isFinite(rate)) return null;
  return {
    unit_type: unitType,
    procedure_code: String(picked.procedure_code ?? "").toUpperCase(),
    rate,
    place_of_service: picked.place_of_service ?? null,
    diagnosis_code: picked.default_diagnosis_code ?? null,
  };
}

/**
 * Units are driven by the legs actually entered, not by the trip_kind label:
 * a "round trip" with one usable leg bills one unit and raises a warning.
 */
export function computeUnits(snap: DraftSnapshot): { units: number; warnings: BillingWarning[] } {
  const warnings: BillingWarning[] = [];
  const billable = (snap.legs ?? []).filter(isBillableLeg).length;
  const expected = snap.trip_kind === "round_trip" ? 2 : 1;
  const units = billable > 0 ? billable : 0;
  if (billable !== expected)
    warnings.push({
      code: "units_vs_trip_kind",
      message:
        billable === 0
          ? `This claim is marked ${expected === 2 ? "round trip" : "one way"} but no leg has usable odometer readings yet.`
          : `This claim is marked ${expected === 2 ? "round trip" : "one way"} (${expected} unit${expected > 1 ? "s" : ""}) but ${billable} leg${billable > 1 ? "s have" : " has"} usable odometer readings — billing ${billable} unit${billable > 1 ? "s" : ""}.`,
    });
  return { units, warnings };
}

const isSameCode = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase() &&
  String(a ?? "").trim() !== "";

/** Full live calculation for the current in-memory draft. */
export function computeDraftBilling(
  snap: DraftSnapshot,
  rates: RateSetting[],
  opts: { providerId?: string | null } = {},
): DraftBilling {
  const warnings: BillingWarning[] = [];
  const legs = snap.legs ?? [];
  const { units, warnings: unitWarnings } = computeUnits(snap);
  warnings.push(...unitWarnings);

  const bad = invalidLegIndexes(legs);
  if (bad.length)
    warnings.push({
      code: "invalid_legs",
      message: `Leg ${bad.map((i) => i + 1).join(", ")} ${bad.length > 1 ? "have" : "has"} missing or reversed odometer readings and ${bad.length > 1 ? "are" : "is"} not billed.`,
    });

  const odo = odometerMiles(legs.filter(isBillableLeg));
  const overrideActive =
    snap.miles_override != null && String(snap.miles_override_reason ?? "").trim() !== "";
  const miles = overrideActive ? Number(snap.miles_override) : odo;
  if (snap.miles_override != null && !overrideActive)
    warnings.push({
      code: "override_reason_missing",
      message: "A manual mileage override needs a written reason before it can be billed.",
    });

  const trip_rate = resolveRate(rates, snap.vehicle_type, "trip", opts.providerId);
  const mile_rate = resolveRate(rates, snap.vehicle_type, "mile", opts.providerId);
  const missing_rates: ("trip" | "mile")[] = [];
  if (!trip_rate) missing_rates.push("trip");
  if (!mile_rate) missing_rates.push("mile");
  if (missing_rates.length)
    warnings.push({
      code: "rate_missing",
      message: `No configured ${missing_rates.join(" and ")} rate for ${snap.vehicle_type ? snap.vehicle_type.replace(/_/g, " ") : "this vehicle type"} — set it in Billing settings before queueing.`,
    });

  const lines: BillingLine[] = [];
  const base_charge = trip_rate ? round2(units * trip_rate.rate) : null;
  const mileage_charge = mile_rate ? round2(miles * mile_rate.rate) : null;
  if (trip_rate)
    lines.push({
      kind: "trip",
      label: "Trip / base charge",
      procedure_code: trip_rate.procedure_code,
      quantity: units,
      rate: trip_rate.rate,
      amount: base_charge!,
      breakdown: `${units} trip unit${units === 1 ? "" : "s"} × ${money(trip_rate.rate)}`,
    });
  if (mile_rate)
    lines.push({
      kind: "mile",
      label: "Mileage charge",
      procedure_code: mile_rate.procedure_code,
      quantity: miles,
      rate: mile_rate.rate,
      amount: mileage_charge!,
      breakdown: `${miles} mile${miles === 1 ? "" : "s"} × ${money(mile_rate.rate)}`,
    });

  // Any draft line whose procedure code is neither configured code is an
  // explicitly configured extra — counted once, never duplicated.
  const extra_lines = (snap.lines ?? []).filter(
    (l) =>
      !isSameCode(l.procedure_code, trip_rate?.procedure_code) &&
      !isSameCode(l.procedure_code, mile_rate?.procedure_code),
  );
  const extra_charge = round2(extra_lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));

  const total =
    missing_rates.length === 2
      ? extra_charge > 0
        ? extra_charge
        : null
      : round2((base_charge ?? 0) + (mileage_charge ?? 0) + extra_charge);

  return {
    vehicle_type: snap.vehicle_type ?? null,
    units,
    miles: round2(miles),
    miles_source: overrideActive ? "override" : "odometer",
    valid_legs: legs.filter(isBillableLeg).length,
    trip_rate,
    mile_rate,
    missing_rates,
    lines,
    base_charge,
    mileage_charge,
    extra_charge,
    extra_lines,
    total,
    warnings,
  };
}

export type LineDifference = {
  procedure_code: string;
  field: "missing" | "units" | "miles" | "amount";
  expected: number | null;
  actual: number | null;
  message: string;
};

export type LineConsistency = {
  ok: boolean;
  checked: boolean;
  differences: LineDifference[];
  /** Draft lines whose amount differs from the rate-derived amount. */
  manual_overrides: { procedure_code: string; expected: number; actual: number }[];
};

const near = (a: number | null | undefined, b: number | null | undefined) =>
  Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005;

/** Compare the live calculation against the editable draft service lines. */
export function compareServiceLines(
  snap: DraftSnapshot,
  billing: DraftBilling,
): LineConsistency {
  if (!billing.lines.length)
    return { ok: false, checked: false, differences: [], manual_overrides: [] };

  const differences: LineDifference[] = [];
  const manual_overrides: LineConsistency["manual_overrides"] = [];

  for (const calc of billing.lines) {
    const line = (snap.lines ?? []).find((l) => isSameCode(l.procedure_code, calc.procedure_code));
    if (!line) {
      differences.push({
        procedure_code: calc.procedure_code,
        field: "missing",
        expected: calc.amount,
        actual: null,
        message: `No ${calc.procedure_code} service line exists for the calculated ${calc.label.toLowerCase()}.`,
      });
      continue;
    }
    if (calc.kind === "trip" && !near(line.units, calc.quantity))
      differences.push({
        procedure_code: calc.procedure_code,
        field: "units",
        expected: calc.quantity,
        actual: line.units ?? null,
        message: `${calc.procedure_code}: calculated ${calc.quantity} unit(s), line has ${line.units ?? "—"}.`,
      });
    if (calc.kind === "mile") {
      const qty = line.miles ?? line.units ?? null;
      if (!near(qty, calc.quantity))
        differences.push({
          procedure_code: calc.procedure_code,
          field: "miles",
          expected: calc.quantity,
          actual: qty,
          message: `${calc.procedure_code}: calculated ${calc.quantity} mile(s), line has ${qty ?? "—"}.`,
        });
    }
    if (!near(line.amount, calc.amount)) {
      differences.push({
        procedure_code: calc.procedure_code,
        field: "amount",
        expected: calc.amount,
        actual: line.amount ?? null,
        message: `${calc.procedure_code}: calculated ${money(calc.amount)}, line has ${money(line.amount ?? null)}.`,
      });
      if (line.amount != null)
        manual_overrides.push({
          procedure_code: calc.procedure_code,
          expected: calc.amount,
          actual: Number(line.amount),
        });
    }
  }

  return { ok: differences.length === 0, checked: true, differences, manual_overrides };
}

/**
 * Explicit "apply calculated values" action. Never called automatically:
 * it rewrites only the configured trip/mileage lines, keeps their modifiers,
 * and leaves every unrelated custom line exactly as the biller typed it.
 */
export function applyCalculatedLines(
  snap: DraftSnapshot,
  billing: DraftBilling,
): DraftSnapshot {
  if (!billing.lines.length) return snap;
  const existing = snap.lines ?? [];
  const kept = existing.filter(
    (l) => !billing.lines.some((c) => isSameCode(l.procedure_code, c.procedure_code)),
  );

  const applied: DraftServiceLine[] = billing.lines.map((calc) => {
    const prev = existing.find((l) => isSameCode(l.procedure_code, calc.procedure_code));
    const rate = calc.kind === "trip" ? billing.trip_rate : billing.mile_rate;
    return {
      line_index: 0,
      service_date: prev?.service_date ?? snap.service_date ?? null,
      procedure_code: calc.procedure_code,
      place_of_service: prev?.place_of_service ?? rate?.place_of_service ?? null,
      diagnosis_code: prev?.diagnosis_code ?? rate?.diagnosis_code ?? null,
      units: calc.kind === "trip" ? calc.quantity : calc.quantity,
      miles: calc.kind === "mile" ? calc.quantity : (prev?.miles ?? null),
      amount: calc.amount,
      modifiers: prev?.modifiers ?? [],
    };
  });

  const lines = [...applied, ...kept].map((l, i) => ({ ...l, line_index: i + 1 }));
  return { ...snap, lines };
}

/** One-line human summary used by Review and the audit trail. */
export function billingSummaryText(b: DraftBilling): string {
  const parts = [
    `${b.units} unit${b.units === 1 ? "" : "s"}`,
    `${b.miles} mile${b.miles === 1 ? "" : "s"}${b.miles_source === "override" ? " (manual override)" : ""}`,
    b.total == null ? "total unavailable — rate missing" : `total ${money(b.total)}`,
  ];
  return parts.join(" · ");
}

export { legMilesOf, effectiveMiles };
