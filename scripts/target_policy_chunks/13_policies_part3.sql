-- RedArt target bootstrap — public-table RLS policies (part 3 of 4)
-- Extracted verbatim from scripts/target_schema_parts/10_policies.sql; run in order after 09_grants_rls.sql.

CREATE POLICY "tenant_isolation" ON public.medicaid_trips
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "messages admin all" ON public.messages
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "messages driver insert own thread" ON public.messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))) AND (sender_id = auth.uid())));

CREATE POLICY "messages driver read own thread" ON public.messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "messages driver update own read flag" ON public.messages
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "Admins manage news" ON public.news_items
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone signed in can read active news" ON public.news_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((is_active = true) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Public can read active news" ON public.news_items
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING ((is_active = true));

CREATE POLICY "passengers admin all" ON public.passengers
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "passengers dispatch read" ON public.passengers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_is_dispatch());

CREATE POLICY "passengers driver read assigned" ON public.passengers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (driver_can_see_passenger(id));

CREATE POLICY "passengers self read" ON public.passengers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY "tenant_isolation" ON public.passengers
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "payroll_audit_read" ON public.payroll_audit_log
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR ((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role)))));

CREATE POLICY "payroll_audit_write" ON public.payroll_audit_log
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))));

CREATE POLICY "payroll_items_company_read" ON public.payroll_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR ((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))) OR (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = payroll_items.driver_id) AND (d.user_id = auth.uid()))))));

CREATE POLICY "payroll_items_staff_delete" ON public.payroll_items
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role)) AND (payroll_status <> 'paid'::text)));

CREATE POLICY "payroll_items_staff_update" ON public.payroll_items
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))))
  WITH CHECK ((company_id = current_user_company_id()));

CREATE POLICY "payroll_items_staff_write" ON public.payroll_items
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))));

CREATE POLICY "Admins manage pricing" ON public.pricing_config
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone signed in reads pricing" ON public.pricing_config
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles admin insert" ON public.profiles
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((id = auth.uid()) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "profiles billing read" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_can_bill());

CREATE POLICY "profiles dispatch read" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_is_dispatch());

CREATE POLICY "profiles self read" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((id = auth.uid()) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "profiles self update" ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((id = auth.uid()) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "tenant_isolation" ON public.profiles
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id()) OR (id = auth.uid())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id()) OR (id = auth.uid())));

CREATE POLICY "Admins can read all push subs" ON public.push_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_has_role('admin'::app_role));

CREATE POLICY "Users manage own push subs" ON public.push_subscriptions
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "settings readable by authed" ON public.rewards_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin manages ride passengers" ON public.ride_passengers
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "Driver reads own group manifest" ON public.ride_passengers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = ride_passengers.trip_id) AND (d.user_id = auth.uid())))));

CREATE POLICY "ride_passengers dispatch all" ON public.ride_passengers
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_is_dispatch())
  WITH CHECK (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.ride_passengers
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (COALESCE(company_of_trip(trip_id), company_of_ride_request(request_id)) = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (COALESCE(company_of_trip(trip_id), company_of_ride_request(request_id)) = current_user_company_id())));

CREATE POLICY "Admins full access ride_requests" ON public.ride_requests
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Drivers see pending and assigned requests" ON public.ride_requests
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_role(auth.uid(), 'driver'::app_role) AND ((status = 'pending'::text) OR (driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))))));

CREATE POLICY "Drivers update their assigned or claim pending" ON public.ride_requests
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_role(auth.uid(), 'driver'::app_role) AND ((status = 'pending'::text) OR (driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))))));

CREATE POLICY "Passengers manage their own requests" ON public.ride_requests
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((passenger_id = auth.uid()))
  WITH CHECK ((passenger_id = auth.uid()));

CREATE POLICY "Users create their own ride requests" ON public.ride_requests
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((passenger_id = auth.uid()));

CREATE POLICY "ride_requests dispatch all" ON public.ride_requests
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_is_dispatch())
  WITH CHECK (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.ride_requests
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Admins can delete riders" ON public.riders
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Drivers and admins can insert riders" ON public.riders
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'driver'::app_role)));

CREATE POLICY "Drivers can update riders they created; admins any" ON public.riders
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR (created_by = auth.uid())))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR (created_by = auth.uid())));

CREATE POLICY "Riders readable by staff and assigned drivers" ON public.riders
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) OR current_user_is_dispatch() OR (created_by = auth.uid()) OR driver_can_see_rider(id)));

CREATE POLICY "riders billing insert" ON public.riders
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_can_bill());

CREATE POLICY "riders billing read" ON public.riders
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_can_bill());

CREATE POLICY "riders billing update" ON public.riders
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (current_user_can_bill())
  WITH CHECK (current_user_can_bill());

CREATE POLICY "tenant_isolation" ON public.riders
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Admins manage robot api keys" ON public.robot_api_keys
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "billing staff can read robot workers" ON public.robot_workers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR current_user_can_bill()));

CREATE POLICY "route_stops driver read own" ON public.route_stops
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (routes r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_stops.route_id) AND (d.user_id = auth.uid())))));

CREATE POLICY "route_stops driver update own" ON public.route_stops
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (routes r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_stops.route_id) AND (d.user_id = auth.uid())))));
