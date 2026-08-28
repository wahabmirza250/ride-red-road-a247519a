-- RedArt target bootstrap — storage.objects policies + realtime publication/replica identity
-- Extracted verbatim from scripts/target_schema_parts/10_policies.sql. Storage policies require the buckets to exist first.

CREATE POLICY "Admins manage state pdfs" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'state-pdfs'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((bucket_id = 'state-pdfs'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Billers manage state pdfs" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'state-pdfs'::text) AND current_user_can_bill()))
  WITH CHECK (((bucket_id = 'state-pdfs'::text) AND current_user_can_bill()));

CREATE POLICY "Billers read signatures" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'signatures'::text) AND current_user_can_bill()));

CREATE POLICY "Drivers read own signatures; admins all" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'signatures'::text) AND (has_role(auth.uid(), 'admin'::app_role) OR ((storage.foldername(name))[1] = (auth.uid())::text))));

CREATE POLICY "Drivers read own state pdfs" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'state-pdfs'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR has_role(auth.uid(), 'admin'::app_role))));

CREATE POLICY "Drivers update own state pdfs" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = 'state-pdfs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
  WITH CHECK (((bucket_id = 'state-pdfs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Drivers upload own signatures" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'signatures'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'admin'::app_role))));

CREATE POLICY "Drivers upload own state pdfs" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'state-pdfs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "authenticated delete own nemt objects" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((bucket_id = ANY (ARRAY['profiles'::text, 'odometers'::text, 'receipts'::text, 'inspections'::text, 'incidents'::text])) AND (owner = auth.uid())));

CREATE POLICY "authenticated update own nemt objects" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = ANY (ARRAY['profiles'::text, 'odometers'::text, 'receipts'::text, 'inspections'::text, 'incidents'::text])) AND (owner = auth.uid())));

CREATE POLICY "authenticated upload own nemt objects" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = ANY (ARRAY['profiles'::text, 'odometers'::text, 'receipts'::text, 'inspections'::text, 'incidents'::text])) AND (owner = auth.uid()) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR current_user_has_role('admin'::app_role))));

CREATE POLICY "avatars admin write" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'avatars'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((bucket_id = 'avatars'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "avatars authenticated read" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((bucket_id = 'avatars'::text));

CREATE POLICY "avatars owner update" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "avatars owner upload" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_docs_own_delete" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((bucket_id = 'driver-docs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_docs_own_read" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'driver-docs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_docs_own_update" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = 'driver-docs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_docs_own_write" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'driver-docs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_docs_staff_read" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'driver-docs'::text) AND (current_user_has_role('admin'::app_role) OR current_user_is_dispatch() OR current_user_can_bill()) AND (EXISTS ( SELECT 1
   FROM drivers d
  WHERE (((d.user_id)::text = (storage.foldername(objects.name))[1]) AND (d.company_id = current_user_company_id()))))));

CREATE POLICY "driver_photos_admin_all" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'driver-photos'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((bucket_id = 'driver-photos'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "driver_photos_delete_own" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((bucket_id = 'driver-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_photos_insert_own" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'driver-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "driver_photos_read_scoped" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'driver-photos'::text) AND can_view_driver_media((NULLIF((storage.foldername(name))[1], ''::text))::uuid)));

CREATE POLICY "driver_photos_update_own" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = 'driver-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
  WITH CHECK (((bucket_id = 'driver-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "games admin delete" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((bucket_id = 'games'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "games admin update" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = 'games'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "games admin write" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'games'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "games read all authenticated" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((bucket_id = 'games'::text));

CREATE POLICY "gas receipts driver rw" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'gas-receipts'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR current_user_has_role('admin'::app_role))))
  WITH CHECK (((bucket_id = 'gas-receipts'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR current_user_has_role('admin'::app_role))));

CREATE POLICY "owners and staff read nemt buckets" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = ANY (ARRAY['profiles'::text, 'odometers'::text, 'receipts'::text, 'inspections'::text, 'incidents'::text])) AND ((owner = auth.uid()) OR current_user_has_role('admin'::app_role) OR current_user_has_role('dispatch'::app_role))));

CREATE POLICY "trip media driver rw" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'trip-media'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR current_user_has_role('admin'::app_role))))
  WITH CHECK (((bucket_id = 'trip-media'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR current_user_has_role('admin'::app_role))));

CREATE POLICY "vehicle_photos_admin_all" ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'vehicle-photos'::text) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((bucket_id = 'vehicle-photos'::text) AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "vehicle_photos_delete_own" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((bucket_id = 'vehicle-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "vehicle_photos_insert_own" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'vehicle-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "vehicle_photos_read_scoped" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'vehicle-photos'::text) AND can_view_driver_media((NULLIF((storage.foldername(name))[1], ''::text))::uuid)));

CREATE POLICY "vehicle_photos_update_own" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((bucket_id = 'vehicle-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

-- Realtime publication membership (publication itself is Supabase-managed)
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_audit_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.medicaid_trips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.route_stops;
ALTER PUBLICATION supabase_realtime ADD TABLE public.routes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;

-- Tables with REPLICA IDENTITY FULL (full row payloads in realtime)
ALTER TABLE public.drivers REPLICA IDENTITY FULL;
ALTER TABLE public.medicaid_trips REPLICA IDENTITY FULL;
ALTER TABLE public.ride_requests REPLICA IDENTITY FULL;
