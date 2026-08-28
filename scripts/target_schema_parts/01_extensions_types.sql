-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 1: extensions, enums and domains
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

-- Extensions required by the schema. pg_cron / pg_net are intentionally
-- OMITTED: they exist on the source only to run production schedules,
-- which are excluded from this export.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TYPE public.app_role AS ENUM ('admin', 'driver', 'passenger', 'dispatch', 'platform_owner', 'billing', 'admin_biller');
CREATE TYPE public.billing_status AS ENUM ('pending', 'submitted', 'paid', 'rejected');
CREATE TYPE public.driver_pay_type AS ENUM ('per_hour', 'commission');
CREATE TYPE public.driver_status AS ENUM ('available', 'busy', 'offline');
CREATE TYPE public.incident_status AS ENUM ('open', 'reviewed', 'closed');
CREATE TYPE public.incident_type AS ENUM ('accident', 'late', 'no_show', 'complaint', 'mechanical', 'other');
CREATE TYPE public.medicaid_trip_status AS ENUM ('pending_review', 'approved', 'rejected', 'submitted', 'needs_fix');
CREATE TYPE public.nemt_trip_kind AS ENUM ('one_way', 'round_trip', 'group_tour');
CREATE TYPE public.nemt_vehicle_type AS ENUM ('ground_ambulance', 'wheelchair_van', 'stretcher_van', 'taxi', 'ambulatory');
CREATE TYPE public.shift_status AS ENUM ('scheduled', 'completed', 'no_show');
CREATE TYPE public.trip_status AS ENUM ('scheduled', 'assigned', 'driver_en_route_to_pickup', 'arrived_at_pickup', 'in_progress', 'completed', 'cancelled', 'no_show');
