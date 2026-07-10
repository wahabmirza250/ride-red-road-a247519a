
DROP POLICY IF EXISTS "trips public read by id" ON public.trips;

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
REVOKE ALL ON FUNCTION public.get_public_trip_track(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_trip_track(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.driver_can_see_passenger(_passenger_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
     WHERE d.user_id = auth.uid()
       AND t.passenger_id = _passenger_id
  )
$$;
REVOKE ALL ON FUNCTION public.driver_can_see_passenger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_can_see_passenger(uuid) TO authenticated;

DROP POLICY IF EXISTS "passengers driver read" ON public.passengers;
CREATE POLICY "passengers driver read assigned"
  ON public.passengers
  FOR SELECT
  TO authenticated
  USING (public.driver_can_see_passenger(id));

DROP POLICY IF EXISTS "drivers all drivers read" ON public.drivers;

CREATE OR REPLACE FUNCTION public.riders_force_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.riders_force_created_by() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS riders_force_created_by ON public.riders;
CREATE TRIGGER riders_force_created_by
  BEFORE INSERT ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.riders_force_created_by();

REVOKE ALL ON FUNCTION public.ensure_billing_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_driver_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admin_driver_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admin_new_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_trip_chat() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_driver_rating() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_driver_trips() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_default_billing_portal(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_billing_portal(text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_portal_credential(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_portal_credential(text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(text, text, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_has_role(app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(app_role) TO authenticated;
