-- RedArt target bootstrap — public-table RLS policies (part 1 of 4)
-- Extracted verbatim from scripts/target_schema_parts/10_policies.sql; run in order after 09_grants_rls.sql.

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
