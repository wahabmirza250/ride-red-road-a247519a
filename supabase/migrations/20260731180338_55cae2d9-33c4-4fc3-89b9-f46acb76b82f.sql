-- 1) avatars: authenticated only
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars authenticated read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

-- 2) nemt buckets: ownership on insert
DROP POLICY IF EXISTS "authenticated upload nemt buckets" ON storage.objects;
CREATE POLICY "authenticated upload own nemt objects"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['profiles','odometers','receipts','inspections','incidents'])
  AND owner = auth.uid()
  AND ((storage.foldername(name))[1] = (auth.uid())::text OR public.current_user_has_role('admin'))
);

-- 3) driver/vehicle photos: owner, staff, or a passenger actively riding with that driver
CREATE OR REPLACE FUNCTION public.can_view_driver_media(_driver_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _driver_user_id IS NOT NULL AND (
    _driver_user_id = auth.uid()
    OR public.current_user_has_role('admin')
    OR public.current_user_is_dispatch()
    OR EXISTS (
      SELECT 1 FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      JOIN public.passengers p ON p.id = t.passenger_id
      WHERE d.user_id = _driver_user_id AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.ride_requests r
      JOIN public.drivers d ON d.id = r.driver_id
      WHERE d.user_id = _driver_user_id AND r.passenger_id = auth.uid()
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_view_driver_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_driver_media(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "driver_photos_read_auth" ON storage.objects;
CREATE POLICY "driver_photos_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'driver-photos'
  AND public.can_view_driver_media(NULLIF((storage.foldername(name))[1], '')::uuid)
);

DROP POLICY IF EXISTS "vehicle_photos_read_auth" ON storage.objects;
CREATE POLICY "vehicle_photos_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'vehicle-photos'
  AND public.can_view_driver_media(NULLIF((storage.foldername(name))[1], '')::uuid)
);

-- 4) riders: drivers only see riders they created or who ride with them
CREATE OR REPLACE FUNCTION public.driver_can_see_rider(_rider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.medicaid_trips mt
    WHERE mt.rider_id = _rider_id AND mt.driver_id = auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION public.driver_can_see_rider(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_can_see_rider(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Drivers and admins can read riders" ON public.riders;
CREATE POLICY "Riders readable by staff and assigned drivers"
ON public.riders FOR SELECT TO authenticated
USING (
  public.current_user_has_role('admin')
  OR public.current_user_is_dispatch()
  OR created_by = auth.uid()
  OR public.driver_can_see_rider(id)
);

-- 5) revoke anon execute on internal SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.requests_on_route(uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ride_request_view(uuid) FROM anon, PUBLIC;