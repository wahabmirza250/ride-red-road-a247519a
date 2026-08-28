-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 9: Data API grants and RLS enablement
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

-- GRANTs for the Data API roles

-- Row Level Security enabled on 76 of 76 tables
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_pilot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_rate_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_modifier_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_resubmissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_service_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_status_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_comm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_pay_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destination_place_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destination_review_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_trip_report_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_claim_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_claim_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_hour_clearings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_insurance_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_pay ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_pay_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_trip_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gas_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_claim_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicaid_trip_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicaid_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rewards_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.robot_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.robot_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_portal_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_queue_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_destination_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_expenses ENABLE ROW LEVEL SECURITY;
