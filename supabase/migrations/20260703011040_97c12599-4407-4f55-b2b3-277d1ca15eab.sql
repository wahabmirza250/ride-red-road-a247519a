
-- Signatures bucket: driver folder = their user id
CREATE POLICY "Drivers upload own signatures"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Drivers read own signatures; admins all"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- State PDFs: admin only
CREATE POLICY "Admins manage state pdfs"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'state-pdfs' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'state-pdfs' AND public.has_role(auth.uid(), 'admin'));
