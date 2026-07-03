
-- Allow authenticated users to upload to any of the 5 buckets
CREATE POLICY "authenticated upload nemt buckets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('profiles','odometers','receipts','inspections','incidents'));

-- Allow authenticated users to read any object in these buckets (photos are shared between admin/driver/passenger for legitimate operational reasons; access is already gated by app-level RLS on the parent records)
CREATE POLICY "authenticated read nemt buckets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('profiles','odometers','receipts','inspections','incidents'));

-- Allow uploaders to update/delete their own files
CREATE POLICY "authenticated update own nemt objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('profiles','odometers','receipts','inspections','incidents') AND owner = auth.uid());

CREATE POLICY "authenticated delete own nemt objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('profiles','odometers','receipts','inspections','incidents') AND owner = auth.uid());
