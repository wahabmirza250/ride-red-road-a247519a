/**
 * Multi-passenger vehicle journey model for the RedArt driver app.
 *
 * One driver runs ONE active journey. A journey is an ordered list of stops
 * (pickups and drop-offs) that may belong to several different passengers who
 * share the vehicle at the same time. Every passenger keeps an independent
 * record: their own pickup/drop-off timestamps, signature, and mileage
 * evidence. Completing one drop-off never completes anybody else's ride.
 *
 * Pure module — no React, no network — so all sequencing rules are unit
 * testable and safe to re-run after an app refresh.
 */

export type StopKind = "pickup" | "dropoff";
export type StopStatus = "pending" | "arrived" | "done";

export type JourneyStop = {
  /** Stable id (route_stop id when the journey comes from a dispatch route). */
  id: string;
  sequence: number;
  kind: StopKind;
  /** Groups the pickup and drop-off that belong to the same passenger ride. */
  ride_id: string;
  passenger_name: string;
  medicaid_id: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  status: StopStatus;
  arrived_at: string | null;
  completed_at: string | null;
  /** Odometer reading captured at this stop, as typed by the driver. */
  odometer: string | null;
  signature_data_url: string | null;
  signer_name: string | null;
  notes: string | null;
};

export type TracePoint = { lat: number; lng: number; at: string };

export type JourneyEvent = {
  /** Deterministic key — replaying the same key is ignored (double taps). */
  key: string;
  action: "arrive" | "complete" | "start_journey" | "finish_journey";
  stop_id: string | null;
  at: string;
};

export type Journey = {
  id: string;
  company_id: string;
  driver_id: string;
  started_at: string | null;
  finished_at: string | null;
  odometer_start: string | null;
  odometer_end: string | null;
  stops: JourneyStop[];
  events: JourneyEvent[];
  trace: TracePoint[];
};

export const MAX_TRACE_POINTS = 5000;

export type StopSeed = Omit<
  JourneyStop,
  "status" | "arrived_at" | "completed_at" | "odometer" | "signature_data_url" | "signer_name"
> &
  Partial<Pick<JourneyStop, "status" | "arrived_at" | "completed_at">>;

export function createJourney(input: {
  id: string;
  company_id: string;
  driver_id: string;
  stops: StopSeed[];
}): Journey {
  return {
    id: input.id,
    company_id: input.company_id,
    driver_id: input.driver_id,
    started_at: null,
    finished_at: null,
    odometer_start: null,
    odometer_end: null,
    stops: input.stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        ...s,
        odometer: null,
        signature_data_url: null,
        signer_name: null,
        notes: s.notes ?? null,
        arrived_at: s.arrived_at ?? null,
        completed_at: s.completed_at ?? null,
        status: s.completed_at ? "done" : (s.status ?? "pending"),
      })) as JourneyStop[],
    events: [],
    trace: [],
  };
}

/* --------------------------------- reads --------------------------------- */

export function nextStop(j: Journey): JourneyStop | null {
  return j.stops.find((s) => s.status !== "done") ?? null;
}

export function completedCount(j: Journey): number {
  return j.stops.filter((s) => s.status === "done").length;
}

export function isJourneyComplete(j: Journey): boolean {
  return j.stops.length > 0 && j.stops.every((s) => s.status === "done");
}

/** Passengers currently in the vehicle: picked up but not yet dropped off. */
export function onboardRides(j: Journey): string[] {
  const out: string[] = [];
  for (const rideId of rideIds(j)) {
    const pickup = j.stops.find((s) => s.ride_id === rideId && s.kind === "pickup");
    const dropoff = j.stops.find((s) => s.ride_id === rideId && s.kind === "dropoff");
    if (pickup?.status === "done" && dropoff?.status !== "done") out.push(rideId);
  }
  return out;
}

export function rideIds(j: Journey): string[] {
  return Array.from(new Set(j.stops.map((s) => s.ride_id)));
}

export type RideStatus = "waiting" | "on_board" | "completed";

export function rideStatus(j: Journey, rideId: string): RideStatus {
  const dropoff = j.stops.find((s) => s.ride_id === rideId && s.kind === "dropoff");
  const pickup = j.stops.find((s) => s.ride_id === rideId && s.kind === "pickup");
  if (dropoff?.status === "done") return "completed";
  if (pickup?.status === "done") return "on_board";
  return "waiting";
}

/** Driver-facing summary, e.g. "3 passengers · 6 stops". */
export function journeySummary(j: Journey): string {
  const riders = rideIds(j).length;
  return `${riders} ${riders === 1 ? "passenger" : "passengers"} · ${j.stops.length} ${
    j.stops.length === 1 ? "stop" : "stops"
  }`;
}

/** The action the driver should take next, in plain language. */
export function nextActionLabel(j: Journey): string {
  const s = nextStop(j);
  if (!s) return "Finish Route";
  if (s.status === "pending") {
    return s.kind === "pickup" ? "Navigate to Pickup" : "Navigate to Drop-off";
  }
  return s.kind === "pickup" ? "Confirm Pickup" : "Complete Drop-off";
}

export function stopTitle(s: JourneyStop): string {
  return s.kind === "pickup" ? "Pickup" : "Drop-off";
}

/* -------------------------------- mutations ------------------------------- */

function alreadyApplied(j: Journey, key: string): boolean {
  return j.events.some((e) => e.key === key);
}

function push(j: Journey, event: JourneyEvent): Journey {
  return { ...j, events: [...j.events, event] };
}

export function startJourney(j: Journey, at: string, odometerStart?: string | null): Journey {
  if (j.started_at) return j;
  return push(
    { ...j, started_at: at, odometer_start: odometerStart ?? j.odometer_start },
    { key: `start:${j.id}`, action: "start_journey", stop_id: null, at },
  );
}

/**
 * Marks arrival at a stop. Repeat taps are ignored, so a double tap can never
 * record two arrivals.
 */
export function arriveAtStop(j: Journey, stopId: string, at: string): Journey {
  const key = `arrive:${stopId}`;
  if (alreadyApplied(j, key)) return j;
  const stop = j.stops.find((s) => s.id === stopId);
  if (!stop || stop.status !== "pending") return j;
  const stops = j.stops.map((s) =>
    s.id === stopId ? { ...s, status: "arrived" as StopStatus, arrived_at: at } : s,
  );
  return push({ ...j, stops }, { key, action: "arrive", stop_id: stopId, at });
}

export type CompleteStopInput = {
  at: string;
  odometer?: string | null;
  signature_data_url?: string | null;
  signer_name?: string | null;
  notes?: string | null;
};

/** What is still missing before this stop can be completed. */
export function stopBlockers(
  j: Journey,
  stopId: string,
  input: Partial<CompleteStopInput> = {},
): string[] {
  const stop = j.stops.find((s) => s.id === stopId);
  const missing: string[] = [];
  if (!stop) return ["Stop not found"];
  if (stop.status === "pending") missing.push("Mark arrival first");
  const odo = input.odometer ?? stop.odometer;
  if (!isValidOdometer(odo)) missing.push("Odometer reading");
  const sig = input.signature_data_url ?? stop.signature_data_url;
  if (stop.kind === "dropoff" && !sig) missing.push("Passenger signature");
  return missing;
}

export function isValidOdometer(v: string | null | undefined): boolean {
  if (v == null) return false;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 && String(v).trim() !== "";
}

/**
 * Completes exactly one stop and advances the journey to the next stop.
 * Only the passenger attached to this stop is affected.
 */
export function completeStop(j: Journey, stopId: string, input: CompleteStopInput): Journey {
  const key = `complete:${stopId}`;
  if (alreadyApplied(j, key)) return j;
  const stop = j.stops.find((s) => s.id === stopId);
  if (!stop || stop.status === "done") return j;
  const stops = j.stops.map((s) =>
    s.id === stopId
      ? {
          ...s,
          status: "done" as StopStatus,
          completed_at: input.at,
          arrived_at: s.arrived_at ?? input.at,
          odometer: input.odometer ?? s.odometer,
          signature_data_url: input.signature_data_url ?? s.signature_data_url,
          signer_name: input.signer_name ?? s.signer_name,
          notes: input.notes ?? s.notes,
        }
      : s,
  );
  const next = push({ ...j, stops }, { key, action: "complete", stop_id: stopId, at: input.at });
  return isJourneyComplete(next) ? finishJourney(next, input.at) : next;
}

export function finishJourney(j: Journey, at: string, odometerEnd?: string | null): Journey {
  if (j.finished_at) return j;
  return push(
    { ...j, finished_at: at, odometer_end: odometerEnd ?? j.odometer_end },
    { key: `finish:${j.id}`, action: "finish_journey", stop_id: null, at },
  );
}

/* ------------------------------ mileage trace ----------------------------- */

export function recordPosition(j: Journey, p: TracePoint, minMeters = 25): Journey {
  const last = j.trace[j.trace.length - 1];
  if (last && metersBetween(last, p) < minMeters) return j;
  const trace = [...j.trace, p];
  return { ...j, trace: trace.slice(-MAX_TRACE_POINTS) };
}

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type RideMileage = {
  ride_id: string;
  passenger_name: string;
  onboard_from: string | null;
  onboard_to: string | null;
  /** Distance from the recorded position trace while the passenger was aboard. */
  traced_miles: number | null;
  /** Distance from odometer readings at pickup and drop-off. */
  odometer_miles: number | null;
};

/**
 * Per-passenger mileage evidence. Recorded for review only — Medicaid billing
 * mileage is unchanged and still comes from the existing billing rules.
 */
export function rideMileage(j: Journey): RideMileage[] {
  return rideIds(j).map((rideId) => {
    const pickup = j.stops.find((s) => s.ride_id === rideId && s.kind === "pickup");
    const dropoff = j.stops.find((s) => s.ride_id === rideId && s.kind === "dropoff");
    const from = pickup?.completed_at ?? null;
    const to = dropoff?.completed_at ?? null;
    let traced: number | null = null;
    if (from && to) {
      const seg = j.trace.filter((p) => p.at >= from && p.at <= to);
      let meters = 0;
      for (let i = 1; i < seg.length; i++) meters += metersBetween(seg[i - 1], seg[i]);
      traced = seg.length > 1 ? meters / 1609.344 : 0;
    }
    let odo: number | null = null;
    if (isValidOdometer(pickup?.odometer) && isValidOdometer(dropoff?.odometer)) {
      const a = Number(pickup!.odometer);
      const b = Number(dropoff!.odometer);
      odo = b >= a ? b - a : null;
    }
    return {
      ride_id: rideId,
      passenger_name: pickup?.passenger_name ?? dropoff?.passenger_name ?? "Passenger",
      onboard_from: from,
      onboard_to: to,
      traced_miles: traced === null ? null : Math.round(traced * 100) / 100,
      odometer_miles: odo === null ? null : Math.round(odo * 100) / 100,
    };
  });
}
