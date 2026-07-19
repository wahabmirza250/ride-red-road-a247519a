
DROP POLICY IF EXISTS "gas receipts driver rw" ON storage.objects;
CREATE POLICY "gas receipts driver rw" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'gas-receipts' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')))
  WITH CHECK (bucket_id = 'gas-receipts' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')));

DROP POLICY IF EXISTS "trip media driver rw" ON storage.objects;
CREATE POLICY "trip media driver rw" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'trip-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')))
  WITH CHECK (bucket_id = 'trip-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')));
