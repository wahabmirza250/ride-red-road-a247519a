-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 2: tables, columns and defaults (no constraints yet)
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

CREATE TABLE public.admin_notifications (
  id uuid DEFAULT gen_random_uuid(),
  kind text,
  title text,
  body text DEFAULT ''::text,
  data jsonb DEFAULT '{}'::jsonb,
  url text,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.app_settings (
  key text,
  value text,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.auto_pilot_runs (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  status text DEFAULT 'running'::text,
  started_by uuid,
  total_requested integer DEFAULT 0,
  total_enqueued integer DEFAULT 0,
  scope_ids jsonb,
  last_feed_at timestamp with time zone,
  last_note text,
  stopped_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.billing_audit_log (
  id uuid DEFAULT gen_random_uuid(),
  billing_record_id uuid,
  action text,
  actor_id uuid,
  actor_type text DEFAULT 'admin'::text,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.billing_rate_settings (
  id uuid DEFAULT gen_random_uuid(),
  provider_id uuid,
  vehicle_type text,
  procedure_code text,
  charge_amount numeric(10,2),
  unit_type text,
  place_of_service text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  default_diagnosis_code text,
  company_id uuid
);

CREATE TABLE public.billing_records (
  id uuid DEFAULT gen_random_uuid(),
  trip_id uuid,
  trip_form_id uuid,
  status text DEFAULT 'pending_review'::text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  fix_notes text,
  rejection_reason text,
  submitted_at timestamp with time zone,
  state_confirmation_number text,
  submission_error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  requires_human_step boolean DEFAULT false,
  company_id uuid,
  status_checked_at timestamp with time zone,
  portal_status_raw text,
  auto_retry_count integer DEFAULT 0,
  status_check_next_at timestamp with time zone,
  status_check_attempts integer DEFAULT 0,
  status_check_error text,
  status_check_locked_until timestamp with time zone,
  status_check_started_at timestamp with time zone,
  status_check_last_ms integer,
  status_check_worker text,
  submit_locked_until timestamp with time zone,
  submit_lease_started_at timestamp with time zone,
  submit_worker text,
  submit_attempt_count integer DEFAULT 0,
  submit_next_attempt_at timestamp with time zone,
  submit_last_error text,
  submit_last_ms integer,
  submit_account_key text,
  submit_idempotency_key text,
  submit_batch_id uuid,
  submit_heartbeat_at timestamp with time zone,
  failure_stage text,
  failure_code text,
  attention_archived_at timestamp with time zone,
  attention_archived_by uuid,
  attention_archive_reason text,
  submit_wave_hold boolean DEFAULT false
);

CREATE TABLE public.billing_settings (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  default_portal_id text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  auto_pilot_default boolean DEFAULT true
);

CREATE TABLE public.chat_conversations (
  id uuid DEFAULT gen_random_uuid(),
  kind text,
  driver_user_id uuid,
  passenger_user_id uuid,
  trip_id uuid,
  is_closed boolean DEFAULT false,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.chat_messages (
  id uuid DEFAULT gen_random_uuid(),
  conversation_id uuid,
  sender_id uuid,
  body text,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.claim_modifier_audit (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  service_line_id uuid,
  resubmission_id uuid,
  action text,
  modifier text,
  reason text,
  actor_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.claim_resubmissions (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  original_trip_id uuid,
  original_claim_number text,
  original_denial_reason text,
  original_status text,
  status text DEFAULT 'draft'::text,
  resubmission_claim_number text,
  notes text,
  created_by uuid,
  submitted_by uuid,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.claim_service_lines (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  resubmission_id uuid,
  trip_id uuid,
  line_index integer DEFAULT 1,
  service_date date,
  procedure_code text,
  units numeric(10,2),
  miles numeric(10,2),
  amount numeric(12,2),
  modifiers text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.claim_status_sync_state (
  id boolean DEFAULT true,
  singleton boolean DEFAULT true,
  paused boolean DEFAULT false,
  pause_reason text,
  lease_until timestamp with time zone,
  last_run_at timestamp with time zone,
  last_result jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.companies (
  id uuid DEFAULT gen_random_uuid(),
  name text,
  logo_url text,
  url_slug text,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  twilio_phone text,
  max_drivers integer,
  max_dispatchers integer,
  max_billers integer,
  max_admins integer
);

CREATE TABLE public.company_comm_settings (
  company_id uuid,
  provider text DEFAULT 'telnyx'::text,
  sms_from_number text,
  messaging_profile_id text,
  sms_enabled boolean DEFAULT false,
  inbound_webhook_path text,
  notify_bill_approved boolean DEFAULT false,
  notify_bill_rejected boolean DEFAULT false,
  notify_trip_assigned boolean DEFAULT false,
  notify_driver_arriving boolean DEFAULT false,
  notify_trip_reminder boolean DEFAULT false,
  setup_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.company_pay_settings (
  company_id uuid,
  default_plan text DEFAULT 'hourly'::text,
  hourly_rate numeric,
  commission_percentage numeric,
  per_trip_amount numeric,
  commission_base text DEFAULT 'unset'::text,
  per_trip_source text DEFAULT 'completed_trips'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.company_subscriptions (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  plan_name text DEFAULT 'Standard'::text,
  monthly_price numeric(10,2) DEFAULT 0,
  status text DEFAULT 'trial'::text,
  started_on date DEFAULT CURRENT_DATE,
  renews_on date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.contest_entries (
  id uuid DEFAULT gen_random_uuid(),
  passenger_id uuid,
  period_start date,
  period_end date,
  ride_count integer DEFAULT 0,
  qualified_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.contest_winners (
  id uuid DEFAULT gen_random_uuid(),
  passenger_id uuid,
  period_start date,
  period_end date,
  prize_description text,
  selected_at timestamp with time zone DEFAULT now(),
  delivered_at timestamp with time zone,
  delivery_note text
);

CREATE TABLE public.destination_place_cache (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  normalized_key text,
  address text,
  place jsonb,
  nearby jsonb DEFAULT '[]'::jsonb,
  provider text,
  lookup_ok boolean DEFAULT true,
  fetched_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.destination_review_overrides (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  trip_id uuid,
  billing_record_id uuid,
  classification_id uuid,
  original_status text,
  original_summary text,
  note text,
  overridden_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.dispatch_events (
  id uuid DEFAULT gen_random_uuid(),
  kind text,
  actor_id uuid,
  actor_name text,
  actor_role text,
  request_id uuid,
  trip_id uuid,
  route_id uuid,
  driver_id uuid,
  summary text,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  company_id uuid
);

CREATE TABLE public.dispatch_trip_report_drafts (
  id uuid DEFAULT gen_random_uuid(),
  dispatch_trip_id uuid,
  form_data jsonb DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.driver_claim_payout_items (
  id uuid DEFAULT gen_random_uuid(),
  payout_id uuid,
  trip_id uuid,
  amount numeric DEFAULT 0,
  trip_date date,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.driver_claim_payouts (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  driver_id uuid,
  period_start date,
  period_end date,
  total_billed numeric DEFAULT 0,
  percentage_used numeric,
  payout_amount numeric DEFAULT 0,
  claim_count integer DEFAULT 0,
  notes text,
  paid_at timestamp with time zone DEFAULT now(),
  paid_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  extra_amount numeric DEFAULT 0,
  extra_note text
);

CREATE TABLE public.driver_hour_clearings (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  cleared_by uuid,
  cleared_at timestamp with time zone DEFAULT now(),
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  shift_count integer DEFAULT 0,
  hours numeric DEFAULT 0,
  hourly_rate numeric,
  earnings numeric,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid
);

CREATE TABLE public.driver_insurance_docs (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  driver_id uuid,
  insurer text,
  policy_number text,
  vehicle_label text,
  vehicle_plate text,
  effective_date date,
  expiration_date date,
  document_path text,
  notes text,
  status text DEFAULT 'pending'::text,
  verified_by uuid,
  verified_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.driver_pay (
  driver_id uuid,
  hourly_rate numeric,
  pay_type driver_pay_type DEFAULT 'per_hour'::driver_pay_type,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  payout_percentage numeric,
  company_id uuid
);

CREATE TABLE public.driver_pay_plans (
  driver_id uuid,
  company_id uuid,
  plan text,
  hourly_rate numeric,
  commission_percentage numeric,
  per_trip_amount numeric,
  commission_base text,
  per_trip_source text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.driver_payout_items (
  id uuid DEFAULT gen_random_uuid(),
  payout_id uuid,
  company_id uuid,
  driver_id uuid,
  kind text,
  ref_id uuid,
  amount numeric DEFAULT 0,
  quantity numeric,
  occurred_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.driver_payouts (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  hours numeric DEFAULT 0,
  hourly_rate numeric,
  gross_earnings numeric DEFAULT 0,
  fuel_reimbursed numeric DEFAULT 0,
  total_paid numeric DEFAULT 0,
  method text DEFAULT 'manual'::text,
  reference text,
  notes text,
  paid_by uuid,
  paid_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  bonus_amount numeric DEFAULT 0,
  bonus_note text,
  company_id uuid,
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  shift_count integer DEFAULT 0,
  plan text,
  hourly_pay numeric DEFAULT 0,
  commission_percentage numeric,
  commission_base text,
  revenue_base numeric DEFAULT 0,
  commission_amount numeric DEFAULT 0,
  claim_count integer DEFAULT 0,
  per_trip_amount numeric,
  trip_count integer DEFAULT 0,
  trip_pay numeric DEFAULT 0,
  breakdown jsonb
);

CREATE TABLE public.driver_shifts (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  clock_in_at timestamp with time zone DEFAULT now(),
  clock_out_at timestamp with time zone,
  start_odometer integer,
  end_odometer integer,
  gps_miles numeric(10,2) DEFAULT 0,
  hourly_rate_snapshot numeric(10,2) DEFAULT 0,
  earnings numeric(10,2) DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  cleared_at timestamp with time zone,
  cleared_batch_id uuid,
  company_id uuid,
  payout_id uuid
);

CREATE TABLE public.driver_trip_drafts (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  driver_id uuid,
  rider_id uuid,
  assigned_trip_id uuid,
  label text,
  status text DEFAULT 'in_progress'::text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.drivers (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid,
  license_number text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_plate text,
  vehicle_color text,
  status driver_status DEFAULT 'offline'::driver_status,
  current_lat double precision,
  current_lng double precision,
  last_location_at timestamp with time zone,
  photo_url text,
  rating numeric(3,2) DEFAULT 0,
  total_ratings integer DEFAULT 0,
  total_trips integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  default_vehicle_type nemt_vehicle_type,
  default_plate text,
  default_vin text,
  vehicle_photo_path text,
  company_id uuid,
  unit_number text,
  vehicle_vin text,
  merged_into uuid,
  merged_at timestamp with time zone
);

CREATE TABLE public.events (
  id uuid DEFAULT gen_random_uuid(),
  title text,
  description text DEFAULT ''::text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  location_address text,
  location_lat double precision,
  location_lng double precision,
  image_url text,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.fuel_logs (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  log_date date DEFAULT CURRENT_DATE,
  gallons numeric(6,2),
  cost_per_gallon numeric(6,3),
  total_cost numeric(8,2),
  odometer integer,
  station text,
  receipt_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.games (
  id uuid DEFAULT gen_random_uuid(),
  title text,
  url text,
  thumbnail_url text,
  category text,
  description text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.gas_receipts (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  shift_id uuid,
  amount numeric(10,2),
  gallons numeric(10,3),
  photo_path text,
  notes text,
  submitted_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  reimbursed_at timestamp with time zone,
  reimbursed_by uuid,
  company_id uuid,
  payout_id uuid
);

CREATE TABLE public.incidents (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  trip_id uuid,
  incident_type incident_type,
  description text,
  photo_url text,
  status incident_status DEFAULT 'open'::incident_status,
  admin_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.inspections (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  inspection_date date DEFAULT CURRENT_DATE,
  items jsonb,
  passed boolean,
  notes text,
  photo_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.manual_claim_records (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  driver_id uuid,
  passenger_name text,
  service_date date,
  claim_number text,
  billed_amount numeric(12,2),
  driver_pay_amount numeric(12,2) DEFAULT 0,
  claim_status text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.medicaid_trip_legs (
  id uuid DEFAULT gen_random_uuid(),
  medicaid_trip_id uuid,
  leg_index smallint,
  leg_date date,
  pickup_time time without time zone,
  pickup_odometer numeric(10,1),
  pickup_address text,
  dropoff_time time without time zone,
  dropoff_odometer numeric(10,1),
  dropoff_address text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.medicaid_trips (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  rider_id uuid,
  pickup_at timestamp with time zone,
  pickup_address text,
  dropoff_address text,
  odometer_start numeric(10,1),
  odometer_end numeric(10,1),
  miles numeric(10,1),
  signature_path text,
  signature_name text,
  status medicaid_trip_status DEFAULT 'pending_review'::medicaid_trip_status,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  state_pdf_path text,
  submitted_confirmation text,
  submitted_at timestamp with time zone,
  submitted_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  portal_status text DEFAULT 'not_sent'::text,
  portal_run_id uuid,
  portal_confirmation text,
  portal_evidence_prefix text,
  portal_error text,
  portal_submitted_at timestamp with time zone,
  portal_mfa_prompt text,
  trip_kind nemt_trip_kind DEFAULT 'one_way'::nemt_trip_kind,
  vehicle_type nemt_vehicle_type,
  vehicle_plate text,
  vehicle_vin text,
  escort_name text,
  identity_verified boolean DEFAULT true,
  signed_by_escort boolean DEFAULT false,
  group_id uuid,
  state_pdf_generated_at timestamp with time zone,
  pickup_started_at timestamp with time zone,
  arrived_pickup_at timestamp with time zone,
  ride_started_at timestamp with time zone,
  arrived_dropoff_at timestamp with time zone,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  robot_job_id text,
  robot_job_started_at timestamp with time zone,
  robot_last_status text,
  robot_last_message text,
  robot_last_checked_at timestamp with time zone,
  dispatch_trip_id uuid,
  robot_captured_claim jsonb,
  robot_captured_at timestamp with time zone,
  robot_pass text,
  robot_confirmation_number text,
  company_id uuid,
  paper_driver_name text,
  created_by uuid,
  robot_worker_id text,
  robot_worker_url text
);

CREATE TABLE public.messages (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  sender_id uuid,
  sender_role app_role,
  receiver_id uuid,
  body text,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.news_items (
  id uuid DEFAULT gen_random_uuid(),
  title text,
  body text,
  image_url text,
  link_url text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.passengers (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  phone text,
  email text,
  medicaid_id text,
  county text,
  address text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  ssn_last4 text,
  device_id text,
  last_ip text,
  approx_city text,
  approx_region text,
  last_seen_at timestamp with time zone,
  ssn_secret_id uuid,
  company_id uuid
);

CREATE TABLE public.payroll_audit_log (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  payroll_item_id uuid,
  action text,
  actor_id uuid,
  notes text,
  data jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.payroll_items (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  driver_id uuid,
  kind text DEFAULT 'claim'::text,
  ref_id uuid,
  service_date date,
  passenger_name text,
  description text,
  category text,
  amount numeric(12,2) DEFAULT 0,
  payroll_status text DEFAULT 'added'::text,
  payout_id uuid,
  claim_number text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pricing_config (
  id uuid DEFAULT gen_random_uuid(),
  base_fare numeric(10,2) DEFAULT 3.00,
  per_km numeric(10,2) DEFAULT 1.50,
  per_minute numeric(10,2) DEFAULT 0.25,
  currency text DEFAULT 'USD'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  avatar_url text,
  company_id uuid,
  sms_alerts_enabled boolean DEFAULT true
);

CREATE TABLE public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rewards_settings (
  id boolean DEFAULT true,
  enabled boolean DEFAULT false,
  rides_required integer DEFAULT 15,
  period_type text DEFAULT 'weekly'::text,
  prize_description text DEFAULT '$25 Gift Card'::text,
  winners_per_period integer DEFAULT 1,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ride_passengers (
  id uuid DEFAULT gen_random_uuid(),
  request_id uuid,
  trip_id uuid,
  name text,
  phone text,
  medicaid_id text,
  pickup_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_address text,
  dropoff_lat double precision,
  dropoff_lng double precision,
  pickup_sequence integer,
  dropoff_sequence integer,
  picked_up_at timestamp with time zone,
  dropped_off_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ride_requests (
  id uuid DEFAULT gen_random_uuid(),
  passenger_id uuid,
  driver_id uuid,
  trip_id uuid,
  pickup_address text,
  pickup_lat numeric(10,7),
  pickup_lng numeric(10,7),
  dropoff_address text,
  dropoff_lat numeric(10,7),
  dropoff_lng numeric(10,7),
  distance_km numeric(10,2),
  estimated_fare numeric(10,2),
  estimated_minutes integer,
  status text DEFAULT 'pending'::text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  contact_name text,
  contact_phone text,
  contact_medicaid text,
  requested_pickup_time timestamp with time zone,
  source text DEFAULT 'app'::text,
  declined_driver_ids uuid[] DEFAULT '{}'::uuid[],
  offer_expires_at timestamp with time zone,
  ride_purpose text,
  is_group boolean DEFAULT false,
  group_size integer DEFAULT 1,
  stops jsonb DEFAULT '[]'::jsonb,
  vehicle_type text,
  company_id uuid
);

CREATE TABLE public.riders (
  id uuid DEFAULT gen_random_uuid(),
  full_name text,
  medicaid_id text,
  dob date,
  phone text,
  address text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_4_ssn text,
  ssn_secret_id uuid,
  company_id uuid
);

CREATE TABLE public.robot_api_keys (
  id uuid DEFAULT gen_random_uuid(),
  api_key text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  is_active boolean DEFAULT true
);

CREATE TABLE public.robot_workers (
  id text,
  base_url text,
  enabled boolean DEFAULT true,
  max_active_jobs integer DEFAULT 20,
  last_health_ok_at timestamp with time zone,
  last_health_error text,
  failure_streak integer DEFAULT 0,
  unhealthy_until timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_ids uuid[]
);

CREATE TABLE public.route_stops (
  id uuid DEFAULT gen_random_uuid(),
  route_id uuid,
  sequence integer DEFAULT 1,
  kind text DEFAULT 'pickup'::text,
  leg text DEFAULT 'outbound'::text,
  passenger_name text,
  passenger_phone text,
  passenger_medicaid_id text,
  address text,
  lat double precision,
  lng double precision,
  notes text,
  request_id uuid,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.routes (
  id uuid DEFAULT gen_random_uuid(),
  name text,
  driver_id uuid,
  status text DEFAULT 'draft'::text,
  scheduled_at timestamp with time zone,
  notes text,
  created_by uuid,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid
);

CREATE TABLE public.saved_places (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid,
  label text,
  address text,
  lat numeric(10,7),
  lng numeric(10,7),
  kind text DEFAULT 'custom'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.shifts (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  shift_date date,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  notes text,
  status shift_status DEFAULT 'scheduled'::shift_status,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sms_conversations (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  contact_phone text,
  our_number text,
  passenger_id uuid,
  contact_name text,
  status text DEFAULT 'needs_review'::text,
  is_known_contact boolean DEFAULT false,
  last_message_at timestamp with time zone,
  last_inbound_at timestamp with time zone,
  unread_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sms_messages (
  id uuid DEFAULT gen_random_uuid(),
  conversation_id uuid,
  company_id uuid,
  direction text,
  from_number text,
  to_number text,
  body text,
  provider text DEFAULT 'telnyx'::text,
  provider_message_id text,
  status text DEFAULT 'queued'::text,
  error_message text,
  attempt_count integer DEFAULT 0,
  dedupe_key text,
  event_kind text,
  sent_by uuid,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.staff_conversations (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  member_a uuid,
  member_b uuid,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.staff_messages (
  id uuid DEFAULT gen_random_uuid(),
  conversation_id uuid,
  sender_id uuid,
  body text,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.state_portal_credentials (
  id uuid DEFAULT gen_random_uuid(),
  portal_name text,
  state text,
  login_email text,
  password_secret_id uuid,
  password_last4 text,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  portal_id text,
  company_id uuid,
  password_len integer,
  password_fingerprint text,
  password_updated_at timestamp with time zone
);

CREATE TABLE public.submission_batches (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  created_by uuid,
  label text,
  total_requested integer DEFAULT 0,
  total_enqueued integer DEFAULT 0,
  total_rejected integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  wave_size integer DEFAULT 20,
  auto_pilot boolean DEFAULT true
);

CREATE TABLE public.submission_queue_state (
  id boolean DEFAULT true,
  paused boolean DEFAULT false,
  pause_reason text,
  paused_by uuid,
  last_run_at timestamp with time zone,
  last_result jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.subscription_payments (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  amount numeric(10,2),
  period_start date,
  period_end date,
  paid_on date DEFAULT CURRENT_DATE,
  method text DEFAULT 'other'::text,
  reference text,
  notes text,
  recorded_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.trip_billing_records (
  id uuid DEFAULT gen_random_uuid(),
  trip_id uuid,
  amount numeric(10,2) DEFAULT 0,
  service_code text,
  diagnosis_code text,
  units numeric(8,2) DEFAULT 1,
  rate_per_unit numeric(10,2) DEFAULT 0,
  status billing_status DEFAULT 'pending'::billing_status,
  submitted_at timestamp with time zone,
  paid_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.trip_destination_classifications (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  trip_id uuid,
  destination_text text,
  status text,
  confidence numeric(3,2) DEFAULT 0,
  summary text,
  reasons jsonb DEFAULT '[]'::jsonb,
  matched jsonb DEFAULT '[]'::jsonb,
  evidence jsonb DEFAULT '{}'::jsonb,
  classifier_version text,
  classified_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.trip_media (
  id uuid DEFAULT gen_random_uuid(),
  trip_id uuid,
  kind text,
  storage_path text,
  captured_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.trip_stops (
  id uuid DEFAULT gen_random_uuid(),
  trip_id uuid,
  sequence integer DEFAULT 0,
  kind text DEFAULT 'stop'::text,
  address text,
  lat double precision,
  lng double precision,
  passenger_name text,
  passenger_medicaid_id text,
  arrived_at timestamp with time zone,
  departed_at timestamp with time zone,
  added_by text DEFAULT 'driver'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.trips (
  id uuid DEFAULT gen_random_uuid(),
  driver_id uuid,
  passenger_id uuid,
  status trip_status DEFAULT 'scheduled'::trip_status,
  pickup_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_address text,
  dropoff_lat double precision,
  dropoff_lng double precision,
  waypoints jsonb DEFAULT '[]'::jsonb,
  scheduled_pickup_time timestamp with time zone,
  actual_pickup_time timestamp with time zone,
  actual_dropoff_time timestamp with time zone,
  odometer_start integer,
  odometer_end integer,
  computed_miles numeric(8,2),
  gps_miles numeric(8,2),
  gps_route jsonb DEFAULT '[]'::jsonb,
  odometer_start_photo text,
  odometer_end_photo text,
  billing_status billing_status DEFAULT 'pending'::billing_status,
  passenger_rating integer,
  passenger_rating_note text,
  notes text,
  is_problem boolean DEFAULT false,
  problem_reason text,
  assignment_type text DEFAULT 'manual'::text,
  hcpf_claim_number text,
  patient_confirmed boolean DEFAULT false,
  patient_confirmed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  estimated_fare numeric(10,2),
  estimated_arrival_at timestamp with time zone,
  driver_rating smallint,
  driver_rating_note text,
  signature_url text,
  signed_at timestamp with time zone,
  signer_name text,
  ride_purpose text,
  identity_verified boolean,
  round_trip_group_id uuid,
  round_trip_leg smallint,
  company_id uuid,
  payout_id uuid
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid,
  role app_role,
  created_at timestamp with time zone DEFAULT now(),
  company_id uuid
);

CREATE TABLE public.vehicle_expenses (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid,
  driver_id uuid,
  vehicle_label text,
  vehicle_plate text,
  expense_date date,
  category text DEFAULT 'other'::text,
  amount numeric(12,2) DEFAULT 0,
  odometer numeric(10,1),
  vendor text,
  notes text,
  receipt_path text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
