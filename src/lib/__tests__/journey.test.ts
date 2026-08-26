import { describe, expect, it, beforeEach } from "vitest";
import {
  arriveAtStop,
  completeStop,
  completedCount,
  createJourney,
  isJourneyComplete,
  journeySummary,
  nextActionLabel,
  nextStop,
  onboardRides,
  recordPosition,
  rideMileage,
  rideStatus,
  startJourney,
  stopBlockers,
  type Journey,
  type StopSeed,
} from "@/lib/journey";
import { loadJourney, mergeSavedProgress, saveJourney, clearJourney } from "@/lib/journeyStore";

/** A -> B -> C pickups, then B, A, C drop-offs. */
function seeds(): StopSeed[] {
  const mk = (
    id: string,
    seq: number,
    kind: "pickup" | "dropoff",
    ride: string,
    name: string,
    lat: number,
  ): StopSeed => ({
    id,
    sequence: seq,
    kind,
    ride_id: ride,
    passenger_name: name,
    medicaid_id: `M-${ride}`,
    address: `${seq} Main St`,
    lat,
    lng: -104.99,
    notes: null,
  });
  return [
    mk("s1", 1, "pickup", "A", "Alice", 39.70),
    mk("s2", 2, "pickup", "B", "Bob", 39.71),
    mk("s3", 3, "pickup", "C", "Carla", 39.72),
    mk("s4", 4, "dropoff", "B", "Bob", 39.73),
    mk("s5", 5, "dropoff", "A", "Alice", 39.74),
    mk("s6", 6, "dropoff", "C", "Carla", 39.75),
  ];
}

function newJourney(): Journey {
  return createJourney({ id: "r1", company_id: "co1", driver_id: "d1", stops: seeds() });
}

function finish(j: Journey, stopId: string, at: string, odometer: string): Journey {
  const arrived = arriveAtStop(j, stopId, at);
  const stop = arrived.stops.find((s) => s.id === stopId)!;
  return completeStop(arrived, stopId, {
    at,
    odometer,
    signature_data_url: stop.kind === "dropoff" ? "data:image/png;base64,AAA" : null,
    signer_name: stop.kind === "dropoff" ? stop.passenger_name : null,
  });
}

describe("multi-passenger vehicle journey", () => {
  it("summarises passengers and stops for the driver", () => {
    expect(journeySummary(newJourney())).toBe("3 passengers · 6 stops");
  });

  it("always points at the next stop in sequence", () => {
    let j = newJourney();
    expect(nextStop(j)?.id).toBe("s1");
    expect(nextActionLabel(j)).toBe("Navigate to Pickup");
    j = finish(j, "s1", "2026-08-26T10:00:00Z", "1000");
    expect(nextStop(j)?.id).toBe("s2");
    j = finish(j, "s2", "2026-08-26T10:10:00Z", "1005");
    j = finish(j, "s3", "2026-08-26T10:20:00Z", "1010");
    expect(nextStop(j)?.kind).toBe("dropoff");
    expect(nextActionLabel(j)).toBe("Navigate to Drop-off");
    expect(onboardRides(j).sort()).toEqual(["A", "B", "C"]);
  });

  it("completing one drop-off never completes the other passengers", () => {
    let j = newJourney();
    j = finish(j, "s1", "2026-08-26T10:00:00Z", "1000");
    j = finish(j, "s2", "2026-08-26T10:10:00Z", "1005");
    j = finish(j, "s3", "2026-08-26T10:20:00Z", "1010");
    j = finish(j, "s4", "2026-08-26T10:40:00Z", "1020"); // Bob only

    expect(rideStatus(j, "B")).toBe("completed");
    expect(rideStatus(j, "A")).toBe("on_board");
    expect(rideStatus(j, "C")).toBe("on_board");
    expect(isJourneyComplete(j)).toBe(false);
    expect(completedCount(j)).toBe(4);
    expect(nextStop(j)?.id).toBe("s5");
  });

  it("ignores repeated taps so a stop is never recorded twice", () => {
    let j = arriveAtStop(newJourney(), "s1", "2026-08-26T10:00:00Z");
    j = arriveAtStop(j, "s1", "2026-08-26T10:00:05Z");
    expect(j.events.filter((e) => e.action === "arrive")).toHaveLength(1);

    j = completeStop(j, "s1", { at: "2026-08-26T10:01:00Z", odometer: "1000" });
    const doubled = completeStop(j, "s1", { at: "2026-08-26T10:01:02Z", odometer: "9999" });
    expect(doubled.events.filter((e) => e.action === "complete")).toHaveLength(1);
    expect(doubled.stops.find((s) => s.id === "s1")?.odometer).toBe("1000");
    expect(completedCount(doubled)).toBe(1);
  });

  it("requires arrival, an odometer reading and a signature at drop-off", () => {
    let j = newJourney();
    expect(stopBlockers(j, "s1")).toContain("Mark arrival first");
    j = arriveAtStop(j, "s1", "2026-08-26T10:00:00Z");
    expect(stopBlockers(j, "s1")).toEqual(["Odometer reading"]);
    expect(stopBlockers(j, "s1", { odometer: "1000" })).toEqual([]);

    j = completeStop(j, "s1", { at: "2026-08-26T10:01:00Z", odometer: "1000" });
    j = arriveAtStop(j, "s2", "2026-08-26T10:10:00Z");
    j = completeStop(j, "s2", { at: "2026-08-26T10:11:00Z", odometer: "1005" });
    j = arriveAtStop(j, "s3", "2026-08-26T10:20:00Z");
    j = completeStop(j, "s3", { at: "2026-08-26T10:21:00Z", odometer: "1010" });
    j = arriveAtStop(j, "s4", "2026-08-26T10:30:00Z");
    expect(stopBlockers(j, "s4", { odometer: "1020" })).toContain("Passenger signature");
  });

  it("marks the whole route complete only after the last drop-off", () => {
    let j = newJourney();
    for (const [i, id] of ["s1", "s2", "s3", "s4", "s5", "s6"].entries()) {
      j = finish(j, id, `2026-08-26T1${i}:00:00Z`, String(1000 + i * 5));
    }
    expect(isJourneyComplete(j)).toBe(true);
    expect(j.finished_at).toBeTruthy();
    expect(nextActionLabel(j)).toBe("Finish Route");
  });
});

describe("mileage evidence", () => {
  it("segments the recorded trail per passenger onboard window", () => {
    let j = startJourney(newJourney(), "2026-08-26T10:00:00Z", "1000");
    j = finish(j, "s1", "2026-08-26T10:00:00Z", "1000"); // Alice on board
    // ~1.1 km apart each step
    j = recordPosition(j, { lat: 39.70, lng: -104.99, at: "2026-08-26T10:05:00Z" });
    j = recordPosition(j, { lat: 39.71, lng: -104.99, at: "2026-08-26T10:15:00Z" });
    j = recordPosition(j, { lat: 39.72, lng: -104.99, at: "2026-08-26T10:25:00Z" });
    j = finish(j, "s2", "2026-08-26T10:30:00Z", "1005"); // Bob on board later
    j = recordPosition(j, { lat: 39.74, lng: -104.99, at: "2026-08-26T10:40:00Z" });
    j = finish(j, "s3", "2026-08-26T10:45:00Z", "1010");
    j = finish(j, "s4", "2026-08-26T10:50:00Z", "1020"); // Bob dropped off

    const bob = rideMileage(j).find((m) => m.ride_id === "B")!;
    const alice = rideMileage(j).find((m) => m.ride_id === "A")!;
    expect(bob.onboard_from).toBe("2026-08-26T10:30:00Z");
    expect(bob.onboard_to).toBe("2026-08-26T10:50:00Z");
    expect(bob.odometer_miles).toBe(15);
    expect(bob.traced_miles).not.toBeNull();
    // Alice is still aboard, so her trace window is not closed yet.
    expect(alice.onboard_to).toBeNull();
    expect(alice.traced_miles).toBeNull();
  });

  it("skips near-duplicate positions so the trail stays meaningful", () => {
    let j = newJourney();
    j = recordPosition(j, { lat: 39.7, lng: -104.99, at: "t1" });
    j = recordPosition(j, { lat: 39.70001, lng: -104.99, at: "t2" });
    expect(j.trace).toHaveLength(1);
  });
});

describe("route recovery after a refresh", () => {
  beforeEach(() => clearJourney("co1", "d1"));

  it("restores arrivals, readings and signatures for the same driver", () => {
    let j = newJourney();
    j = finish(j, "s1", "2026-08-26T10:00:00Z", "1000");
    j = arriveAtStop(j, "s2", "2026-08-26T10:10:00Z");
    saveJourney(j);

    const restored = mergeSavedProgress(newJourney(), loadJourney("co1", "d1"));
    expect(restored.stops.find((s) => s.id === "s1")?.status).toBe("done");
    expect(restored.stops.find((s) => s.id === "s1")?.odometer).toBe("1000");
    expect(restored.stops.find((s) => s.id === "s2")?.status).toBe("arrived");
    expect(nextStop(restored)?.id).toBe("s2");
    // Replayed taps stay protected after recovery.
    expect(arriveAtStop(restored, "s2", "later").events.filter((e) => e.action === "arrive"))
      .toHaveLength(1);
  });

  it("never returns another company's or driver's route", () => {
    saveJourney(newJourney());
    expect(loadJourney("co2", "d1")).toBeNull();
    expect(loadJourney("co1", "d2")).toBeNull();
    expect(loadJourney("co1", "d1")).not.toBeNull();
  });
});
