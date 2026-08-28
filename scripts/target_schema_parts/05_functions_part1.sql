-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 5: functions / RPCs (1 of 2)
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bump_chat_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.chat_conversations
     SET last_message_at = NEW.created_at,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bump_sms_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.sms_conversations
     SET last_message_at = NEW.created_at,
         last_inbound_at = CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at ELSE last_inbound_at END,
         unread_count = CASE WHEN NEW.direction = 'inbound' THEN unread_count + 1 ELSE unread_count END,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bump_staff_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.staff_conversations
     SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_view_driver_media(_driver_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _driver_user_id IS NOT NULL AND (
    _driver_user_id = auth.uid()
    OR public.current_user_has_role('admin')
    OR public.current_user_is_dispatch()
    OR EXISTS (
      SELECT 1 FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      JOIN public.passengers p ON p.id = t.passenger_id
      WHERE d.user_id = _driver_user_id AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.ride_requests r
      JOIN public.drivers d ON d.id = r.driver_id
      WHERE d.user_id = _driver_user_id AND r.passenger_id = auth.uid()
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.company_is_active(_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT status = 'active' FROM public.companies WHERE id = _company_id), false)
$function$;

CREATE OR REPLACE FUNCTION public.company_of_driver(_driver_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.company_id FROM public.drivers d WHERE d.id = _driver_id
$function$;

CREATE OR REPLACE FUNCTION public.company_of_ride_request(_request_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.company_id FROM public.ride_requests r WHERE r.id = _request_id
$function$;

CREATE OR REPLACE FUNCTION public.company_of_route(_route_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.company_id FROM public.routes r WHERE r.id = _route_id
$function$;

CREATE OR REPLACE FUNCTION public.company_of_trip(_trip_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.company_id FROM public.trips t WHERE t.id = _trip_id
$function$;

CREATE OR REPLACE FUNCTION public.copy_passenger_ssn_to_rider(_passenger_id uuid, _rider_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _digits TEXT;
  _sid    UUID;
  _src    UUID;
BEGIN
  IF auth.uid() IS NULL
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.riders WHERE id = _rider_id) THEN
    RAISE EXCEPTION 'rider not found';
  END IF;

  SELECT ssn_secret_id INTO _src FROM public.passengers WHERE id = _passenger_id;
  IF _src IS NULL THEN
    RETURN; -- nothing to copy
  END IF;

  SELECT decrypted_secret INTO _digits FROM vault.decrypted_secrets WHERE id = _src;
  IF _digits IS NULL THEN
    RETURN;
  END IF;

  _sid := vault.create_secret(
    _digits,
    'rider_ssn_' || _rider_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Rider SSN (encrypted, copied from passenger)'
  );

  UPDATE public.riders
     SET ssn_secret_id = _sid,
         last_4_ssn = right(_digits, 4),
         updated_at = now()
   WHERE id = _rider_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_bill()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','billing','admin_biller')
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_user_is_billing()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'billing'
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_user_is_dispatch()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('dispatch','admin')
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_user_sees_all_bills()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','admin_biller','platform_owner')
  )
$function$;

CREATE OR REPLACE FUNCTION public.driver_can_see_passenger(_passenger_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
     WHERE d.user_id = auth.uid()
       AND t.passenger_id = _passenger_id
  )
$function$;

CREATE OR REPLACE FUNCTION public.driver_can_see_rider(_rider_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.medicaid_trips mt
    WHERE mt.rider_id = _rider_id AND mt.driver_id = auth.uid()
  )
$function$;

CREATE OR REPLACE FUNCTION public.ensure_billing_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'pending_review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_review') THEN
    INSERT INTO public.billing_records (trip_id, trip_form_id, status)
    VALUES (NEW.id, NEW.id, 'pending_review')
    ON CONFLICT (trip_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_driver_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = 'driver' THEN
    INSERT INTO public.drivers (user_id, status)
    VALUES (NEW.user_id, 'offline')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_decrypted_passenger_ssn(_passenger_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE _sid UUID; _ssn TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin')
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT ssn_secret_id INTO _sid FROM public.passengers WHERE id = _passenger_id;
  IF _sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO _ssn FROM vault.decrypted_secrets WHERE id = _sid;
  RETURN _ssn;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_decrypted_rider_ssn(_rider_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE _sid UUID; _ssn TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin')
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT ssn_secret_id INTO _sid FROM public.riders WHERE id = _rider_id;
  IF _sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO _ssn FROM vault.decrypted_secrets WHERE id = _sid;
  RETURN _ssn;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, portal_name text, state text, login_email text, login_password text, password_len integer, password_fingerprint text, stored_fingerprint text, fingerprint_matches boolean, password_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required: portal logins are never shared between companies';
  END IF;

  RETURN QUERY
  SELECT credential.portal_id,
         credential.portal_name,
         credential.state,
         credential.login_email,
         decrypted.decrypted_secret AS login_password,
         length(decrypted.decrypted_secret)::int AS password_len,
         left(encode(sha256(convert_to(decrypted.decrypted_secret,'UTF8')),'hex'),16) AS password_fingerprint,
         credential.password_fingerprint AS stored_fingerprint,
         (credential.password_fingerprint IS NULL
           OR credential.password_fingerprint
              = left(encode(sha256(convert_to(decrypted.decrypted_secret,'UTF8')),'hex'),16)) AS fingerprint_matches,
         credential.password_updated_at
    FROM public.state_portal_credentials AS credential
    LEFT JOIN vault.decrypted_secrets AS decrypted
      ON decrypted.id = credential.password_secret_id
   WHERE credential.portal_id = _portal_id
     AND credential.company_id = _company_id
   LIMIT 1;

  UPDATE public.state_portal_credentials AS credential
     SET last_used_at = now()
   WHERE credential.portal_id = _portal_id
     AND credential.company_id = _company_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_trip_track(_trip_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'scheduled_pickup_time', t.scheduled_pickup_time,
    'pickup_address', t.pickup_address,
    'dropoff_address', t.dropoff_address,
    'pickup_lat', t.pickup_lat,
    'pickup_lng', t.pickup_lng,
    'dropoff_lat', t.dropoff_lat,
    'dropoff_lng', t.dropoff_lng,
    'gps_route', t.gps_route,
    'driver', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'current_lat', d.current_lat,
      'current_lng', d.current_lng,
      'vehicle_make', d.vehicle_make,
      'vehicle_model', d.vehicle_model,
      'vehicle_year', d.vehicle_year,
      'vehicle_color', d.vehicle_color,
      'vehicle_plate', d.vehicle_plate,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone
      )
    ) END
  )
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE t.id = _trip_id
$function$;

CREATE OR REPLACE FUNCTION public.get_ride_request_view(_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'request', to_jsonb(r.*),
    'driver', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'current_lat', d.current_lat,
      'current_lng', d.current_lng,
      'vehicle_make', d.vehicle_make,
      'vehicle_model', d.vehicle_model,
      'vehicle_year', d.vehicle_year,
      'vehicle_color', d.vehicle_color,
      'vehicle_plate', d.vehicle_plate,
      'vehicle_photo_path', d.vehicle_photo_path,
      'photo_url', d.photo_url,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone,
        'avatar_url', p.avatar_url
      )
    ) END
  )
  FROM public.ride_requests r
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE r.id = _request_id
    AND (
      r.passenger_id = auth.uid()
      OR public.current_user_has_role('admin')
    )
$function$;

CREATE OR REPLACE FUNCTION public.guard_trip_driver_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user = 'service_role'
     OR auth.uid() IS NULL
     OR public.current_user_has_role('admin')
     OR public.current_user_is_dispatch() THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
     WHERE d.id = OLD.driver_id AND d.user_id = auth.uid()
  ) THEN
    RETURN NEW; -- not the assigned driver; RLS handles the rest
  END IF;

  -- Assigned driver: driver_id is immutable, and only progress fields may change.
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    RAISE EXCEPTION 'Drivers cannot reassign a trip';
  END IF;

  IF (NEW.passenger_id, NEW.pickup_address, NEW.pickup_lat, NEW.pickup_lng,
      NEW.dropoff_address, NEW.dropoff_lat, NEW.dropoff_lng,
      NEW.scheduled_pickup_time, NEW.estimated_fare, NEW.billing_status,
      NEW.hcpf_claim_number, NEW.assignment_type, NEW.passenger_rating)
     IS DISTINCT FROM
     (OLD.passenger_id, OLD.pickup_address, OLD.pickup_lat, OLD.pickup_lng,
      OLD.dropoff_address, OLD.dropoff_lat, OLD.dropoff_lng,
      OLD.scheduled_pickup_time, OLD.estimated_fare, OLD.billing_status,
      OLD.hcpf_claim_number, OLD.assignment_type, OLD.passenger_rating)
  THEN
    RAISE EXCEPTION 'Drivers may only update trip progress fields';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF _role::text = 'platform_owner'
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'platform_owner may only be granted directly by the platform';
  END IF;
  IF current_setting('role', true) = 'service_role' OR session_user = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF _role::text IN ('driver','dispatch','admin','billing','admin_biller') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _company uuid;
  _role text;
BEGIN
  BEGIN
    _company := NULLIF(NEW.raw_user_meta_data->>'company_id','')::uuid;
  EXCEPTION WHEN others THEN
    _company := NULL;
  END;
  IF _company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = _company) THEN
    _company := '11111111-2222-4333-8444-555555555555';
  END IF;

  _role := lower(coalesce(NEW.raw_user_meta_data->>'role',''));

  INSERT INTO public.profiles (id, email, first_name, last_name, phone, company_id)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'first_name',''),
          COALESCE(NEW.raw_user_meta_data->>'last_name',''),
          COALESCE(NEW.raw_user_meta_data->>'phone',''),
          _company)
  ON CONFLICT (id) DO NOTHING;

  IF _role IN ('driver','admin','dispatch','billing','admin_biller','platform_owner') THEN
    -- Staff account: assign its real role only, and never create a passenger row.
    INSERT INTO public.user_roles (user_id, role, company_id)
    VALUES (NEW.id, _role::public.app_role, _company)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role, company_id) VALUES (NEW.id, 'passenger', _company)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.passengers (user_id, first_name, last_name, email, phone, medicaid_id, company_id)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'first_name',''),
          COALESCE(NEW.raw_user_meta_data->>'last_name',''),
          NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'phone',''),
          'SELF-' || substr(NEW.id::text,1,8),
          _company)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$function$;
