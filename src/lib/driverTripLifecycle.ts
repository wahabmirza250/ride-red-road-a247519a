/**
 * Deterministic state machine for the driver's SELF-CREATED active trip.
 *
 * The driver creates a trip, drives to the pickup, starts the ride, drives to
 * the drop-off, completes the leg (and optionally a return leg) and only then
 * hands the finished, signed trip to billing. Every transition is explicit —
 * nothing auto-advances — and the whole state lives inside the existing
 * `driver_trip_drafts.payload` JSON so resume works after a refresh, an app
 * restart, or on another phone with the same account.
 *
 * Pure module: no React, no Supabase, so the rules are unit-testable.
 */
import {
  emptyLeg,
  legMiles,
  parseOdometer,
  type DraftLeg,
  type DriverTripDraft,
} from "./driverTripDraft";

/** Billing/PDF contract supports at most two legs (outbound + return). */
export const MAX_LEGS = 2;

export type TripPhase =
  | "draft"
  | "to_pickup"
  | "at_pickup"
  | "in_trip"
  | "at_dropoff"
  | "leg_complete"
  | "ready_to_finish";

export type TripAction =
  | "start_navigation"
  | "arrive_pickup"
  | "start_trip"
  | "arrive_dropoff"
  | "complete_leg"
  | "next_leg"
  | "finish";

export type LifecycleEvent = { action: TripAction; at: string; leg: number };

export type TripLifecycle = {
  phase: TripPhase;
  /** 0-based index of the leg being driven right now. */
  active_leg: number;
  started_at: string | null;
  events: LifecycleEvent[];
};

/** Draft + lifecycle. The extra key is additive; older drafts default cleanly. */
export type ActiveTripDraft = DriverTripDraft & { lifecycle?: TripLifecycle };

export function defaultLifecycle(): TripLifecycle {
  return { phase: "draft", active_leg: 0, started_at: null, events: [] };
}

export function getLifecycle(d: ActiveTripDraft): TripLifecycle {
  const l = d.lifecycle;
  if (!l || typeof l !== "object" || !l.phase) return defaultLifecycle();
  return {
    phase: l.phase,
    active_leg: Number.isFinite(l.active_leg) ? Math.max(0, Math.min(l.active_leg, MAX_LEGS - 1)) : 0,
    started_at: l.started_at ?? null,
    events: Array.isArray(l.events) ? l.events : [],
  };
}

/** Normalizes a draft so it always carries a lifecycle. */
export function withLifecycle(d: ActiveTripDraft): ActiveTripDraft {
  return { ...d, lifecycle: getLifecycle(d) };
}

export function activeLeg(d: ActiveTripDraft): DraftLeg | undefined {
  return d.legs[getLifecycle(d).active_leg];
}

/* ------------------------------ requirements ------------------------------ */

/** What is still missing before the current phase may be left. */
export function blockersFor(d: ActiveTripDraft, action: TripAction): string[] {
  const lc = getLifecycle(d);
  const leg = d.legs[lc.active_leg];
  const missing: string[] = [];

  if (action === "start_navigation") {
    if (d.rider_slots.length === 0) missing.push("Passenger");
    if (!leg?.pickup_address.trim()) missing.push("Pickup address");
    if (!leg?.dropoff_address.trim()) missing.push("Destination");
    if (!d.vehicle_type) missing.push("Vehicle type");
    if (!d.plate.trim()) missing.push("License plate");
  }

  if (action === "start_trip") {
    if (parseOdometer(leg?.pickup_odometer) === null) missing.push("Pickup odometer");
    if (!leg?.pickup_time.trim()) missing.push("Pickup time");
  }

  if (action === "complete_leg") {
    if (parseOdometer(leg?.dropoff_odometer) === null) missing.push("Drop-off odometer");
    else if (leg && legMiles(leg) === null) missing.push("Drop-off odometer must be ≥ pickup");
    if (!leg?.dropoff_time.trim()) missing.push("Drop-off time");
  }

  if (action === "finish") {
    d.rider_slots.forEach((s) => {
      if (!s.signature_data_url) missing.push(`Signature from ${s.rider.full_name}`);
      else if (!s.signer_name.trim()) missing.push(`Signer name for ${s.rider.full_name}`);
    });
    d.legs.forEach((l, i) => {
      const name = d.legs.length > 1 ? (i === 0 ? "Outbound" : "Return") : "Trip";
      if (parseOdometer(l.pickup_odometer) === null) missing.push(`${name}: pickup odometer`);
      if (parseOdometer(l.dropoff_odometer) === null) missing.push(`${name}: drop-off odometer`);
      else if (legMiles(l) === null) missing.push(`${name}: drop-off odometer is lower than pickup`);
      if (!l.dropoff_time.trim()) missing.push(`${name}: drop-off time`);
    });
  }

  return missing;
}

const ALLOWED: Record<TripPhase, TripAction[]> = {
  draft: ["start_navigation"],
  to_pickup: ["arrive_pickup"],
  at_pickup: ["start_trip"],
  in_trip: ["arrive_dropoff"],
  at_dropoff: ["complete_leg"],
  leg_complete: ["next_leg", "finish"],
  ready_to_finish: [],
};

export function allowedActions(d: ActiveTripDraft): TripAction[] {
  const lc = getLifecycle(d);
  const list = ALLOWED[lc.phase] ?? [];
  if (lc.phase === "leg_complete") {
    return list.filter((a) => (a === "next_leg" ? canAddLeg(d) : true));
  }
  return list;
}

/** A return/extra leg is possible while under the billing/PDF two-leg cap. */
export function canAddLeg(d: ActiveTripDraft): boolean {
  return d.legs.length < MAX_LEGS || getLifecycle(d).active_leg < d.legs.length - 1;
}

export function canTransition(d: ActiveTripDraft, action: TripAction): boolean {
  return allowedActions(d).includes(action) && blockersFor(d, action).length === 0;
}

/**
 * Applies a transition. Throws when the action is not allowed from the current
 * phase or when required data for that moment is missing.
 */
export function applyTransition(
  d: ActiveTripDraft,
  action: TripAction,
  now: Date = new Date(),
): ActiveTripDraft {
  const lc = getLifecycle(d);
  if (!allowedActions(d).includes(action)) {
    throw new Error(`Cannot ${action.replace(/_/g, " ")} from ${phaseLabel(d)}`);
  }
  const missing = blockersFor(d, action);
  if (missing.length > 0) throw new Error(`Still needed: ${missing.join(", ")}`);

  const stamp = now.toISOString();
  let legs = d.legs;
  let phase: TripPhase = lc.phase;
  let active = lc.active_leg;
  let startedAt = lc.started_at;

  switch (action) {
    case "start_navigation":
      phase = "to_pickup";
      break;
    case "arrive_pickup":
      phase = "at_pickup";
      break;
    case "start_trip":
      phase = "in_trip";
      startedAt = startedAt ?? stamp;
      break;
    case "arrive_dropoff":
      phase = "at_dropoff";
      break;
    case "complete_leg":
      phase = "leg_complete";
      break;
    case "next_leg": {
      if (legs.length < MAX_LEGS) {
        const prev = legs[active];
        legs = [
          ...legs,
          {
            ...emptyLeg(2),
            leg_date: prev?.leg_date ?? emptyLeg(2).leg_date,
            pickup_address: prev?.dropoff_address ?? "",
            dropoff_address: prev?.pickup_address ?? "",
          },
        ];
      }
      active = Math.min(active + 1, legs.length - 1);
      phase = "to_pickup";
      break;
    }
    case "finish":
      phase = "ready_to_finish";
      break;
  }

  return {
    ...d,
    legs,
    trip_kind: legs.length > 1 && d.trip_kind === "one_way" ? "round_trip" : d.trip_kind,
    lifecycle: {
      phase,
      active_leg: active,
      started_at: startedAt,
      events: [...lc.events, { action, at: stamp, leg: lc.active_leg }],
    },
  };
}

/* -------------------------------- labels ---------------------------------- */

export function phaseLabel(d: ActiveTripDraft): string {
  const lc = getLifecycle(d);
  const many = d.legs.length > 1;
  const legName = many ? (lc.active_leg === 0 ? "outbound" : "return") : "";
  const suffix = legName ? ` (${legName})` : "";
  switch (lc.phase) {
    case "draft":
      return "Draft — not started";
    case "to_pickup":
      return `Navigating to pickup${suffix}`;
    case "at_pickup":
      return `Arrived at pickup${suffix}`;
    case "in_trip":
      return `In trip${suffix}`;
    case "at_dropoff":
      return `Arrived at drop-off${suffix}`;
    case "leg_complete":
      return canAddLeg(d) ? "Leg complete — waiting for next leg" : "Legs complete";
    case "ready_to_finish":
      return "Ready to finish";
  }
}

export function actionLabel(action: TripAction): string {
  switch (action) {
    case "start_navigation":
      return "Start navigation to pickup";
    case "arrive_pickup":
      return "Arrived at pickup";
    case "start_trip":
      return "Start trip";
    case "arrive_dropoff":
      return "Arrived at drop-off";
    case "complete_leg":
      return "Complete leg";
    case "next_leg":
      return "Start return leg";
    case "finish":
      return "Finish trip";
  }
}

/** Where the driver is currently heading, for the in-app map. */
export function currentDestination(
  d: ActiveTripDraft,
): { address: string; kind: "pickup" | "dropoff" } | null {
  const lc = getLifecycle(d);
  const leg = d.legs[lc.active_leg];
  if (!leg) return null;
  if (lc.phase === "to_pickup" || lc.phase === "draft" || lc.phase === "at_pickup") {
    return leg.pickup_address ? { address: leg.pickup_address, kind: "pickup" } : null;
  }
  if (lc.phase === "in_trip" || lc.phase === "at_dropoff") {
    return leg.dropoff_address ? { address: leg.dropoff_address, kind: "dropoff" } : null;
  }
  return null;
}

/** True once every required leg + signature exists and billing may receive it. */
export function isReadyForBilling(d: ActiveTripDraft): boolean {
  const lc = getLifecycle(d);
  if (lc.phase !== "ready_to_finish") return false;
  return blockersFor(d, "finish").length === 0;
}
