-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 10: RLS policies (public, then storage.objects) and realtime
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

CREATE POLICY "Admins read admin notifications" ON public.admin_notifications
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_has_role('admin'::app_role));

CREATE POLICY "Admins update admin notifications" ON public.admin_notifications
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "Admins manage app settings" ON public.app_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "billing staff manage own company auto pilot runs" ON public.auto_pilot_runs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_can_bill() OR current_user_has_role('admin'::app_role)))
  WITH CHECK ((current_user_can_bill() OR current_user_has_role('admin'::app_role)));

CREATE POLICY "tenant_isolation" ON public.auto_pilot_runs
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "billing_audit_log admin all" ON public.billing_audit_log
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "billing_audit_log billing all" ON public.billing_audit_log
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_can_bill())
  WITH CHECK (current_user_can_bill());

CREATE POLICY "Admins manage all billing rate settings" ON public.billing_rate_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "billing_rate_settings billing manage" ON public.billing_rate_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_can_bill())
  WITH CHECK (current_user_can_bill());

CREATE POLICY "billing_rate_settings billing read" ON public.billing_rate_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_can_bill());

CREATE POLICY "tenant_isolation" ON public.billing_rate_settings
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "billing_records admin all" ON public.billing_records
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (current_user_has_role('admin'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role));

CREATE POLICY "billing_records billing staff all" ON public.billing_records
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_can_bill() AND (current_user_sees_all_bills() OR (trip_id IN ( SELECT medicaid_trips.id
   FROM medicaid_trips
  WHERE (medicaid_trips.created_by = auth.uid()))))))
  WITH CHECK ((current_user_can_bill() AND (current_user_sees_all_bills() OR (trip_id IN ( SELECT medicaid_trips.id
   FROM medicaid_trips
  WHERE (medicaid_trips.created_by = auth.uid()))))));

CREATE POLICY "billing_records driver read own" ON public.billing_records
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((trip_id IN ( SELECT medicaid_trips.id
   FROM medicaid_trips
  WHERE (medicaid_trips.driver_id = auth.uid()))));

CREATE POLICY "tenant_isolation" ON public.billing_records
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "admins read billing settings" ON public.billing_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_has_role('admin'::app_role));

CREATE POLICY "billing_settings billing read" ON public.billing_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_can_bill());

CREATE POLICY "tenant_isolation" ON public.billing_settings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (company_id = current_user_company_id())))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Admins can update conversations" ON public.chat_conversations
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Participants and admins can view conversations" ON public.chat_conversations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR (driver_user_id = auth.uid()) OR (passenger_user_id = auth.uid())));

CREATE POLICY "Participants can create their conversations" ON public.chat_conversations
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR (driver_user_id = auth.uid()) OR (passenger_user_id = auth.uid())));

CREATE POLICY "Participants and admins can send messages" ON public.chat_messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((c.is_closed = false) OR has_role(auth.uid(), 'admin'::app_role)) AND (has_role(auth.uid(), 'admin'::app_role) OR (c.driver_user_id = auth.uid()) OR (c.passenger_user_id = auth.uid())))))));

CREATE POLICY "Participants and admins can view messages" ON public.chat_messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (c.driver_user_id = auth.uid()) OR (c.passenger_user_id = auth.uid()))))));

CREATE POLICY "Recipients can mark messages read" ON public.chat_messages
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (c.driver_user_id = auth.uid()) OR (c.passenger_user_id = auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (c.driver_user_id = auth.uid()) OR (c.passenger_user_id = auth.uid()))))));

CREATE POLICY "claim_modifier_audit_read" ON public.claim_modifier_audit
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR ((company_id = current_user_company_id()) AND current_user_can_bill())));

CREATE POLICY "claim_modifier_audit_write" ON public.claim_modifier_audit
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND current_user_can_bill()));

CREATE POLICY "claim_resubmissions_delete" ON public.claim_resubmissions
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND current_user_can_bill() AND (status = 'draft'::text)));

CREATE POLICY "claim_resubmissions_read" ON public.claim_resubmissions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR ((company_id = current_user_company_id()) AND current_user_can_bill())));

CREATE POLICY "claim_resubmissions_update" ON public.claim_resubmissions
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND current_user_can_bill()))
  WITH CHECK ((company_id = current_user_company_id()));

CREATE POLICY "claim_resubmissions_write" ON public.claim_resubmissions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND current_user_can_bill()));

CREATE POLICY "claim_service_lines_delete" ON public.claim_service_lines
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND current_user_can_bill()));

CREATE POLICY "claim_service_lines_read" ON public.claim_service_lines
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((owner_unscoped() OR ((company_id = current_user_company_id()) AND current_user_can_bill())));

CREATE POLICY "claim_service_lines_update" ON public.claim_service_lines
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((company_id = current_user_company_id()) AND current_user_can_bill()))
  WITH CHECK ((company_id = current_user_company_id()));

CREATE POLICY "claim_service_lines_write" ON public.claim_service_lines
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = current_user_company_id()) AND current_user_can_bill()));

CREATE POLICY "claim_status_sync_state readable by billing staff" ON public.claim_status_sync_state
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_can_bill() OR current_user_has_role('admin'::app_role)));

CREATE POLICY "Companies are readable by their members" ON public.companies
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((id = current_user_company_id()) OR is_platform_owner()));

CREATE POLICY "Platform owner manages companies" ON public.companies
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_platform_owner())
  WITH CHECK (is_platform_owner());

CREATE POLICY "comm_settings_admin_write" ON public.company_comm_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((((company_id = current_user_company_id()) AND current_user_has_role('admin'::app_role)) OR owner_unscoped()))
  WITH CHECK ((((company_id = current_user_company_id()) AND current_user_has_role('admin'::app_role)) OR owner_unscoped()));

CREATE POLICY "comm_settings_read_own_company" ON public.company_comm_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((company_id = current_user_company_id()) OR owner_unscoped()));

CREATE POLICY "Admins manage their company pay settings" ON public.company_pay_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))))
  WITH CHECK ((current_user_has_role('admin'::app_role) AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "Platform owner manages subscriptions" ON public.company_subscriptions
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_platform_owner())
  WITH CHECK (is_platform_owner());

CREATE POLICY "entries own or admin" ON public.contest_entries
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM passengers p
  WHERE ((p.id = contest_entries.passenger_id) AND (p.user_id = auth.uid()))))));

CREATE POLICY "Admins or winning passenger can read winners" ON public.contest_winners
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_has_role('admin'::app_role) OR (EXISTS ( SELECT 1
   FROM passengers p
  WHERE ((p.id = contest_winners.passenger_id) AND (p.user_id = auth.uid()))))));

CREATE POLICY "billing staff read own company place cache" ON public.destination_place_cache
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "billing staff update own company place cache" ON public.destination_place_cache
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))))
  WITH CHECK ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "billing staff write own company place cache" ON public.destination_place_cache
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((current_user_can_bill() AND ((company_id IS NULL) OR (company_id = current_user_company_id()) OR owner_unscoped())));

CREATE POLICY "billing staff create own company overrides" ON public.destination_review_overrides
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((current_user_can_bill() AND ((company_id IS NULL) OR (company_id = current_user_company_id()) OR owner_unscoped())));

CREATE POLICY "billing staff read own company overrides" ON public.destination_review_overrides
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((current_user_can_bill() AND (owner_unscoped() OR (company_id = current_user_company_id()))));

CREATE POLICY "dispatch_events staff read" ON public.dispatch_events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (current_user_is_dispatch());

CREATE POLICY "tenant_isolation" ON public.dispatch_events
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((owner_unscoped() OR (company_id = current_user_company_id()) OR (company_id IS NULL)))
  WITH CHECK ((owner_unscoped() OR (company_id = current_user_company_id())));

CREATE POLICY "Admins can delete drafts" ON public.dispatch_trip_report_drafts
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Assigned drivers and admins can create drafts" ON public.dispatch_trip_report_drafts
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = dispatch_trip_report_drafts.dispatch_trip_id) AND (d.user_id = auth.uid()))))));

CREATE POLICY "Assigned drivers and admins can read drafts" ON public.dispatch_trip_report_drafts
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM (trips t
     JOIN drivers d ON ((d.id = t.driver_id)))
  WHERE ((t.id = dispatch_trip_report_drafts.dispatch_trip_id) AND (d.user_id = auth.uid()))))));

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

-- ---- storage policies (RedArt-created) ----

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
