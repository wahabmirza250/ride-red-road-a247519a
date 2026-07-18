CREATE OR REPLACE FUNCTION public.get_public_trip_track(_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'scheduled_pickup_time', t.scheduled_pickup_time,
    'pickup_address', t.pickup_address,
    'dropoff_address', t.dropoff_address,
    'pickup_lat', t.pickup_lat,
    'pickup_lng', t.pickup_lng,
    'dropoff_lat', t.dropoff_lat,
    'dropoff_lng', t.dropoff_lng,
    'gps_route', t.gps_route,
    'driver', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'current_lat', d.current_lat,
      'current_lng', d.current_lng,
      'vehicle_make', d.vehicle_make,
      'vehicle_model', d.vehicle_model,
      'vehicle_year', d.vehicle_year,
      'vehicle_color', d.vehicle_color,
      'vehicle_plate', d.vehicle_plate,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone
      )
    ) END
  )
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE t.id = _trip_id
$$;