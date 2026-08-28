-- RedArt target bootstrap — public-table RLS policies (part 2 of 4)
-- Extracted verbatim from scripts/target_schema_parts/10_policies.sql; run in order after 09_grants_rls.sql.

CREATE POLICY "Assigned drivers and admins can update drafts" ON public.dispatch_trip_report_drafts
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = dispatch_trip_report_drafts.dispatch_trip_id) AND (d.user_id = auth.uid()))))))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = dispatch_trip_report_drafts.dispatch_trip_id) AND (d.user_id = auth.uid()))))));

CREATE POLICY "Billing staff manage payout items in their company" ON public.driver_claim_payout_items
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM driver_claim_payouts p
  WHERE ((p.id = driver_claim_payout_items.payout_id) AND current_user_can_bill() AND (p.company_id = current_user_company_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM driver_claim_payouts p
  WHERE ((p.id = driver_claim_payout_items.payout_id) AND current_user_can_bill() AND (p.company_id = current_user_company_id())))));

CREATE POLICY "Billing staff manage payouts in their company" ON public.driver_claim_payouts
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_can_bill() AND (company_id = current_user_company_id())))
  WITH CHECK ((current_user_can_bill() AND ((company_id IS NULL) OR (company_id = current_user_company_id()))));

CREATE POLICY "Drivers can view their own payouts" ON public.driver_claim_payouts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_claim_payouts.driver_id) AND (d.user_id = auth.uid())))));

CREATE POLICY "Admins manage company hour clearings" ON public.driver_hour_clearings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))))
  WITH CHECK ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "insurance_delete" ON public.driver_insurance_docs
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND current_user_has_role('admin'::app_role)));

CREATE POLICY "insurance_insert" ON public.driver_insurance_docs
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_insurance_docs.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role) OR current_user_is_dispatch())));

CREATE POLICY "insurance_read" ON public.driver_insurance_docs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_insurance_docs.driver_id) AND (d.user_id = auth.uid())))) OR ((company_id = current_user_company_id()) AND (current_user_has_role('admin'::app_role) OR current_user_is_dispatch() OR current_user_can_bill()))));

CREATE POLICY "insurance_update" ON public.driver_insurance_docs
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_insurance_docs.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role) OR current_user_is_dispatch())))
  WITH CHECK ((company_id = current_user_company_id()));

CREATE POLICY "Admins manage company driver pay" ON public.driver_pay
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))))
  WITH CHECK ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "Admins manage their company driver pay plans" ON public.driver_pay_plans
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR ((company_id IS NOT NULL) AND (company_id = current_user_company_id())))))
  WITH CHECK ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR ((company_id IS NOT NULL) AND (company_id = current_user_company_id())))));

CREATE POLICY "Admins manage their company payout items" ON public.driver_payout_items
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR ((company_id IS NOT NULL) AND (company_id = current_user_company_id())))))
  WITH CHECK ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR ((company_id IS NOT NULL) AND (company_id = current_user_company_id())))));

CREATE POLICY "Admins manage company driver payouts" ON public.driver_payouts
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))))
  WITH CHECK ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "Admin writes shifts" ON public.driver_shifts
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "Driver reads own shifts" ON public.driver_shifts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_shifts.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "tenant_isolation" ON public.driver_shifts
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Company staff can view saved trips" ON public.driver_trip_drafts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((company_id IS NOT NULL) AND (company_id = current_user_company_id()) AND (current_user_has_role('admin'::app_role) OR current_user_is_dispatch())));

CREATE POLICY "Drivers manage their own saved trips" ON public.driver_trip_drafts
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((driver_id = auth.uid()))
  WITH CHECK ((driver_id = auth.uid()));

CREATE POLICY "drivers admin all" ON public.drivers
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "drivers dispatch read" ON public.drivers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_is_dispatch());

CREATE POLICY "drivers self read" ON public.drivers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY "drivers self update" ON public.drivers
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY "tenant_isolation" ON public.drivers
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Admins manage events" ON public.events
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "Anyone signed in can read active events" ON public.events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((is_active = true) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "fuel admin all" ON public.fuel_logs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "fuel driver rw own" ON public.fuel_logs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))))
  WITH CHECK ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "Admins can delete games" ON public.games
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (current_user_has_role('admin'::app_role));

CREATE POLICY "Admins can insert games" ON public.games
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "Admins can update games" ON public.games
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "Authenticated can view active games" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_active OR current_user_has_role('admin'::app_role)));

CREATE POLICY "Public can read active games" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING ((is_active = true));

CREATE POLICY "Driver manages own receipts" ON public.gas_receipts
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = gas_receipts.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role)))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = gas_receipts.driver_id) AND (d.user_id = auth.uid())))) OR current_user_has_role('admin'::app_role)));

CREATE POLICY "gas_receipts dispatch read" ON public.gas_receipts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.gas_receipts
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "incidents admin all" ON public.incidents
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "incidents driver rw own" ON public.incidents
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))))
  WITH CHECK ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "inspections admin all" ON public.inspections
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "inspections driver rw own" ON public.inspections
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))))
  WITH CHECK ((driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))));

CREATE POLICY "manual_claim_records_delete" ON public.manual_claim_records
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))));

CREATE POLICY "manual_claim_records_insert" ON public.manual_claim_records
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))));

CREATE POLICY "manual_claim_records_read" ON public.manual_claim_records
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR ((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))) OR (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = manual_claim_records.driver_id) AND (d.user_id = auth.uid()))))));

CREATE POLICY "manual_claim_records_update" ON public.manual_claim_records
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND (current_user_can_bill() OR current_user_has_role('admin'::app_role))))
  WITH CHECK ((company_id = current_user_company_id()));

CREATE POLICY "Drivers manage own legs" ON public.medicaid_trip_legs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM medicaid_trips t
  WHERE ((t.id = medicaid_trip_legs.medicaid_trip_id) AND ((t.driver_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM medicaid_trips t
  WHERE ((t.id = medicaid_trip_legs.medicaid_trip_id) AND ((t.driver_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))))));

CREATE POLICY "medicaid_trip_legs billing all" ON public.medicaid_trip_legs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_can_bill() AND (current_user_sees_all_bills() OR (medicaid_trip_id IN ( SELECT medicaid_trips.id
   FROM medicaid_trips
  WHERE (medicaid_trips.created_by = auth.uid()))))))
  WITH CHECK ((current_user_can_bill() AND (current_user_sees_all_bills() OR (medicaid_trip_id IN ( SELECT medicaid_trips.id
   FROM medicaid_trips
  WHERE (medicaid_trips.created_by = auth.uid()))))));

CREATE POLICY "tenant_isolation" ON public.medicaid_trip_legs
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (EXISTS ( SELECT 1
   FROM medicaid_trips t
  WHERE ((t.id = medicaid_trip_legs.medicaid_trip_id) AND (t.company_id = current_user_company_id()))))))
  WITH CHECK ((owner_unscoped() OR (EXISTS ( SELECT 1
   FROM medicaid_trips t
  WHERE ((t.id = medicaid_trip_legs.medicaid_trip_id) AND (t.company_id = current_user_company_id()))))));

CREATE POLICY "Admins delete" ON public.medicaid_trips
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Drivers create own trips" ON public.medicaid_trips
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) AND (driver_id = auth.uid())));

CREATE POLICY "Drivers edit own pending; admins any" ON public.medicaid_trips
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR ((driver_id = auth.uid()) AND (status = ANY (ARRAY['pending_review'::medicaid_trip_status, 'needs_fix'::medicaid_trip_status])))))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR ((driver_id = auth.uid()) AND (status = ANY (ARRAY['pending_review'::medicaid_trip_status, 'needs_fix'::medicaid_trip_status])))));

CREATE POLICY "Drivers see own; admins see all" ON public.medicaid_trips
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR (driver_id = auth.uid())));

CREATE POLICY "medicaid_trips billing insert" ON public.medicaid_trips
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_can_bill());

CREATE POLICY "medicaid_trips billing read" ON public.medicaid_trips
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_can_bill() AND (current_user_sees_all_bills() OR (created_by = auth.uid()))));

CREATE POLICY "medicaid_trips billing update" ON public.medicaid_trips
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((current_user_can_bill() AND (current_user_sees_all_bills() OR (created_by = auth.uid()))))
  WITH CHECK ((current_user_can_bill() AND (current_user_sees_all_bills() OR (created_by = auth.uid()))));
