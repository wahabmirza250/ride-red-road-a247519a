export const MAX_DISPATCH_GPS_AGE_MS = 90_000;
export const DISPATCH_ADVANCE_MS = 15 * 60_000;

export function isPickupDue(time: string | null | undefined, now = Date.now()) {
  if (!time) return true;
  const at = Date.parse(time);
  return Number.isFinite(at) && at <= now + DISPATCH_ADVANCE_MS;
}

export function eligibleForDispatch(driver: {
  status: string; default_vehicle_type: string | null;
  last_location_at: string | null; current_lat: number | null; current_lng: number | null;
}, requiredType: string | null, onShift: boolean, now = Date.now()) {
  const at = Date.parse(driver.last_location_at ?? '');
  return driver.status === 'available' && onShift
    && Number.isFinite(driver.current_lat) && Number.isFinite(driver.current_lng)
    && Math.abs(driver.current_lat!) <= 90 && Math.abs(driver.current_lng!) <= 180
    && Number.isFinite(at) && now - at >= -30_000 && now - at <= MAX_DISPATCH_GPS_AGE_MS
    && (driver.default_vehicle_type ?? 'ambulatory') === (requiredType ?? 'ambulatory');
}
