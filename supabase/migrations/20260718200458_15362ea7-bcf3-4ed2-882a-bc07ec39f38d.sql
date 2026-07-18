CREATE OR REPLACE FUNCTION public.get_ride_request_view(_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'request', to_jsonb(r.*),
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
      'vehicle_photo_path', d.vehicle_photo_path,
      'photo_url', d.photo_url,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone,
        'avatar_url', p.avatar_url
      )
    ) END
  )
  FROM public.ride_requests r
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE r.id = _request_id
    AND (
      r.passenger_id = auth.uid()
      OR public.current_user_has_role('admin')
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_ride_request_view(uuid) TO authenticated;