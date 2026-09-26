/** Whitelist operational fields. Never send server-side payroll values to the driver app. */
export function driverShiftView(row: Record<string, any> | null) {
  if (!row) return null;
  return {
    id: row.id,
    clock_in_at: row.clock_in_at,
    clock_out_at: row.clock_out_at,
    start_odometer: row.start_odometer,
    end_odometer: row.end_odometer,
    gps_miles: row.gps_miles,
  };
}

/** Used for both incoming offers and the active request; deliberately excludes prices. */
export const DRIVER_REQUEST_FIELDS = 'id,passenger_id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,distance_km,estimated_minutes,status,trip_id,driver_id,ride_purpose';
