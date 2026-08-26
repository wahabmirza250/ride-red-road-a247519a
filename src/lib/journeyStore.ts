/**
 * Local persistence for the driver's active vehicle journey.
 *
 * The journey (stop sequence, arrival/completion times, signatures, odometer
 * readings and the recorded position trail) survives an app refresh, a phone
 * restart, or a temporary loss of signal. Storage is scoped per company and
 * per driver so one account can never read another company's journey.
 */
import type { Journey } from "./journey";

const VERSION = 1;

export function journeyStorageKey(companyId: string, driverId: string): string {
  return `redart:journey:v${VERSION}:${companyId}:${driverId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveJourney(j: Journey): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(journeyStorageKey(j.company_id, j.driver_id), JSON.stringify(j));
  } catch {
    /* storage full or unavailable — the journey still lives in memory */
  }
}

export function loadJourney(companyId: string, driverId: string): Journey | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(journeyStorageKey(companyId, driverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Journey;
    if (
      !parsed ||
      !Array.isArray(parsed.stops) ||
      parsed.company_id !== companyId ||
      parsed.driver_id !== driverId
    ) {
      return null;
    }
    return {
      ...parsed,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      trace: Array.isArray(parsed.trace) ? parsed.trace : [],
    };
  } catch {
    return null;
  }
}

export function clearJourney(companyId: string, driverId: string): void {
  storage()?.removeItem(journeyStorageKey(companyId, driverId));
}

/**
 * Re-applies saved driver progress onto a freshly loaded stop list, so a
 * refresh keeps arrivals, signatures and readings even when the office has
 * since added or re-ordered stops.
 */
export function mergeSavedProgress(fresh: Journey, saved: Journey | null): Journey {
  if (!saved) return fresh;
  const byId = new Map(saved.stops.map((s) => [s.id, s]));
  return {
    ...fresh,
    started_at: saved.started_at ?? fresh.started_at,
    finished_at: saved.finished_at ?? fresh.finished_at,
    odometer_start: saved.odometer_start ?? fresh.odometer_start,
    odometer_end: saved.odometer_end ?? fresh.odometer_end,
    events: saved.events,
    trace: saved.trace,
    stops: fresh.stops.map((s) => {
      const prev = byId.get(s.id);
      if (!prev) return s;
      return {
        ...s,
        status: s.status === "done" ? "done" : prev.status,
        arrived_at: prev.arrived_at ?? s.arrived_at,
        completed_at: s.completed_at ?? prev.completed_at,
        odometer: prev.odometer ?? s.odometer,
        signature_data_url: prev.signature_data_url ?? s.signature_data_url,
        signer_name: prev.signer_name ?? s.signer_name,
        notes: prev.notes ?? s.notes,
      };
    }),
  };
}
