CREATE POLICY "driver_photos_read_auth"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'driver-photos');

CREATE POLICY "driver_photos_admin_all"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'driver-photos' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'driver-photos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "driver_photos_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_photos_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_photos_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text);