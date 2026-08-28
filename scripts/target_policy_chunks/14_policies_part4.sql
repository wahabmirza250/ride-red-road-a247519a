-- RedArt target bootstrap — public-table RLS policies (part 4 of 4)
-- Extracted verbatim from scripts/target_schema_parts/10_policies.sql; run in order after 09_grants_rls.sql.

CREATE POLICY "route_stops staff all" ON public.route_stops
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_is_dispatch())
  WITH CHECK (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.route_stops
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (company_of_route(route_id) = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_of_route(route_id) = current_user_company_id())));

CREATE POLICY "routes driver read own" ON public.routes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "routes driver update own" ON public.routes
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "routes staff all" ON public.routes
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_is_dispatch())
  WITH CHECK (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.routes
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Users manage their saved places" ON public.saved_places
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "shifts admin all" ON public.shifts
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "shifts dispatch read" ON public.shifts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_is_dispatch());

CREATE POLICY "shifts driver read own" ON public.shifts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "tenant_isolation" ON public.shifts
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (company_of_driver(driver_id) = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_of_driver(driver_id) = current_user_company_id())));

CREATE POLICY "sms_conversations_read_own_company" ON public.sms_conversations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((company_id = current_user_company_id()) OR owner_unscoped()));

CREATE POLICY "sms_conversations_staff_update" ON public.sms_conversations
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((((company_id = current_user_company_id()) AND (current_user_has_role('admin'::app_role) OR current_user_is_dispatch())) OR owner_unscoped()))
  WITH CHECK ((((company_id = current_user_company_id()) AND (current_user_has_role('admin'::app_role) OR current_user_is_dispatch())) OR owner_unscoped()));

CREATE POLICY "sms_messages_read_own_company" ON public.sms_messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((company_id = current_user_company_id()) OR owner_unscoped()));

CREATE POLICY "Billing staff can start a conversation they are in" ON public.staff_conversations
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((((auth.uid() = member_a) OR (auth.uid() = member_b)) AND current_user_can_bill() AND (company_id = current_user_company_id())));

CREATE POLICY "Members can view their staff conversations" ON public.staff_conversations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((auth.uid() = member_a) OR (auth.uid() = member_b)));

CREATE POLICY "Members can mark staff messages read" ON public.staff_messages
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_staff_conversation_member(conversation_id))
  WITH CHECK (is_staff_conversation_member(conversation_id));

CREATE POLICY "Members can send staff messages" ON public.staff_messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((sender_id = auth.uid()) AND is_staff_conversation_member(conversation_id)));

CREATE POLICY "Members can view their staff messages" ON public.staff_messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_staff_conversation_member(conversation_id));

CREATE POLICY "portal_credentials admin all" ON public.state_portal_credentials
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "portal_credentials billing all" ON public.state_portal_credentials
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_can_bill())
  WITH CHECK (current_user_can_bill());

CREATE POLICY "tenant_isolation" ON public.state_portal_credentials
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "batches_insert" ON public.submission_batches
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((current_user_can_bill() AND (company_id = current_user_company_id()) AND (created_by = auth.uid())));

CREATE POLICY "batches_select" ON public.submission_batches
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((company_id = current_user_company_id()) AND (current_user_sees_all_bills() OR (created_by = auth.uid()))));

CREATE POLICY "batches_update" ON public.submission_batches
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND current_user_can_bill()))
  WITH CHECK ((company_id = current_user_company_id()));

CREATE POLICY "billing staff pause submission queue" ON public.submission_queue_state
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((current_user_can_bill() OR current_user_has_role('admin'::app_role)))
  WITH CHECK ((current_user_can_bill() OR current_user_has_role('admin'::app_role)));

CREATE POLICY "billing staff read submission queue state" ON public.submission_queue_state
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_can_bill() OR current_user_has_role('admin'::app_role)));

CREATE POLICY "billing staff seed submission queue state" ON public.submission_queue_state
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((current_user_can_bill() OR current_user_has_role('admin'::app_role)));

CREATE POLICY "Platform owner manages subscription payments" ON public.subscription_payments
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_platform_owner())
  WITH CHECK (is_platform_owner());

CREATE POLICY "billing admin all" ON public.trip_billing_records
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "billing staff read own company classifications" ON public.trip_destination_classifications
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "billing staff update own company classifications" ON public.trip_destination_classifications
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))))
  WITH CHECK ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "billing staff write own company classifications" ON public.trip_destination_classifications
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((current_user_can_bill() AND ((company_id IS NULL) OR (company_id = current_user_company_id()) OR owner_unscoped())));

CREATE POLICY "Driver writes trip media" ON public.trip_media
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((current_user_has_role('admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = trip_media.trip_id) AND (d.user_id = auth.uid()))))));

CREATE POLICY "Trip participants read media" ON public.trip_media
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) OR (EXISTS ( SELECT 1
   FROM ((trips t
     LEFT JOIN drivers d ON ((d.id = t.driver_id)))
     LEFT JOIN passengers p ON ((p.id = t.passenger_id)))
  WHERE ((t.id = trip_media.trip_id) AND ((d.user_id = auth.uid()) OR (p.user_id = auth.uid())))))));

CREATE POLICY "Driver or admin writes stops" ON public.trip_stops
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = trip_stops.trip_id) AND (d.user_id = auth.uid()))))))
  WITH CHECK ((current_user_has_role('admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = trip_stops.trip_id) AND (d.user_id = auth.uid()))))));

CREATE POLICY "Trip participants read stops" ON public.trip_stops
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) OR (EXISTS ( SELECT 1
   FROM ((trips t
     LEFT JOIN drivers d ON ((d.id = t.driver_id)))
     LEFT JOIN passengers p ON ((p.id = t.passenger_id)))
  WHERE ((t.id = trip_stops.trip_id) AND ((d.user_id = auth.uid()) OR (p.user_id = auth.uid())))))));

CREATE POLICY "tenant_isolation" ON public.trip_stops
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (company_of_trip(trip_id) = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_of_trip(trip_id) = current_user_company_id())));

CREATE POLICY "trip_stops dispatch all" ON public.trip_stops
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_is_dispatch())
  WITH CHECK (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.trips
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "trips admin all" ON public.trips
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "trips dispatch all" ON public.trips
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_is_dispatch())
  WITH CHECK (current_user_is_dispatch());

CREATE POLICY "trips driver read own" ON public.trips
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "trips driver update own" ON public.trips
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "trips passenger insert pending" ON public.trips
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((status = 'scheduled'::trip_status) AND (driver_id IS NULL) AND (passenger_id IN ( SELECT p.id
   FROM passengers p
  WHERE (p.user_id = auth.uid())))));

CREATE POLICY "trips passenger read own" ON public.trips
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((passenger_id IN ( SELECT passengers.id
   FROM passengers
  WHERE (passengers.user_id = auth.uid()))));

CREATE POLICY "tenant_isolation" ON public.user_roles
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id()) OR (user_id = auth.uid())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id()) OR (user_id = auth.uid())));

CREATE POLICY "user_roles admin write" ON public.user_roles
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "user_roles self read" ON public.user_roles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "vehicle_expenses_delete" ON public.vehicle_expenses
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = vehicle_expenses.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role))));

CREATE POLICY "vehicle_expenses_insert" ON public.vehicle_expenses
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = vehicle_expenses.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role) OR current_user_is_dispatch())));

CREATE POLICY "vehicle_expenses_read" ON public.vehicle_expenses
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = vehicle_expenses.driver_id) AND (d.user_id = auth.uid())))) OR ((company_id = current_user_company_id()) AND (current_user_has_role('admin'::app_role) OR current_user_is_dispatch() OR current_user_can_bill()))));

CREATE POLICY "vehicle_expenses_update" ON public.vehicle_expenses
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = vehicle_expenses.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role))))
  WITH CHECK ((company_id = current_user_company_id()));
