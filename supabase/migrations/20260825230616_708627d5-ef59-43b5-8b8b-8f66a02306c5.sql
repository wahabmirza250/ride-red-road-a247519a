-- Files live under: driver-docs/<driver user id>/<filename>
CREATE POLICY "driver_docs_own_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_docs_own_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_docs_own_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_docs_own_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Company staff may read their own company's driver documents.
CREATE POLICY "driver_docs_staff_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-docs'
    AND (
      public.current_user_has_role('admin')
      OR public.current_user_is_dispatch()
      OR public.current_user_can_bill()
    )
    AND EXISTS (
      SELECT 1 FROM public.drivers d
       WHERE d.user_id::text = (storage.foldername(storage.objects.name))[1]
         AND d.company_id = public.current_user_company_id()
    )
  );