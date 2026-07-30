DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Authenticated users can read app settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "authenticated read nemt buckets" ON storage.objects;
CREATE POLICY "owners and staff read nemt buckets"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = ANY (ARRAY['profiles'::text, 'odometers'::text, 'receipts'::text, 'inspections'::text, 'incidents'::text])
  AND (
    owner = auth.uid()
    OR public.current_user_has_role('admin'::public.app_role)
    OR public.current_user_has_role('dispatch'::public.app_role)
  )
);