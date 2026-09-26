import { describe, expect, it } from 'vitest';
import { eligibleForDispatch, isPickupDue } from '../dispatchEligibility';
const now = Date.parse('2026-09-25T12:00:00Z');
const driver = { status: 'available', default_vehicle_type: 'wheelchair', last_location_at: new Date(now).toISOString(), current_lat: 40, current_lng: -105 };
describe('dispatch eligibility', () => {
  it('requires a compatible on-duty driver with fresh GPS', () => {
    expect(eligibleForDispatch(driver, 'wheelchair', true, now)).toBe(true);
    expect(eligibleForDispatch(driver, 'ambulatory', true, now)).toBe(false);
    expect(eligibleForDispatch(driver, 'wheelchair', false, now)).toBe(false);
    expect(eligibleForDispatch({...driver, last_location_at: new Date(now-120_000).toISOString()}, 'wheelchair', true, now)).toBe(false);
    expect(eligibleForDispatch({...driver, current_lat: null}, 'wheelchair', true, now)).toBe(false);
    expect(eligibleForDispatch({...driver, current_lat: 91}, 'wheelchair', true, now)).toBe(false);
  });
  it('holds future rides and rejects malformed pickup dates', () => {
    expect(isPickupDue(null, now)).toBe(true);
    expect(isPickupDue('2026-09-25T12:10:00Z', now)).toBe(true);
    expect(isPickupDue('2026-09-25T14:00:00Z', now)).toBe(false);
    expect(isPickupDue('invalid', now)).toBe(false);
  });
});
