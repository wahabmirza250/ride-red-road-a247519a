
-- Add vehicle photo path column to drivers
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS vehicle_photo_path text;

-- Storage policies for vehicle-photos bucket
-- Authenticated users can read all vehicle photos (private bucket -> signed URLs)
CREATE POLICY "vehicle_photos_read_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'vehicle-photos');

-- Drivers can upload their own vehicle photos (path starts with their user_id)
CREATE POLICY "vehicle_photos_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "vehicle_photos_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "vehicle_photos_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can manage any vehicle photo
CREATE POLICY "vehicle_photos_admin_all"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'vehicle-photos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'vehicle-photos' AND public.has_role(auth.uid(), 'admin'));
