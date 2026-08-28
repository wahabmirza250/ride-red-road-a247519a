-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 6: functions / RPCs (2 of 2)
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.increment_driver_trips()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET total_trips = total_trips + 1 WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'platform_owner'
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_staff_conversation_member(_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_conversations c
    WHERE c.id = _conversation_id
      AND auth.uid() IN (c.member_a, c.member_b)
  )
$function$;

CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(_global_limit integer DEFAULT 20, _per_company_limit integer DEFAULT 4, _lease_seconds integer DEFAULT 180, _worker text DEFAULT NULL::text, _record_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, status text, status_check_attempts integer, claim_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g   integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc  integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls  integer := least(greatest(coalesce(_lease_seconds, 180), 30), 3600);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT br.id, br.trip_id, br.company_id, br.status::text AS status,
           coalesce(br.status_check_attempts, 0) AS attempts,
           nullif(btrim(coalesce(br.state_confirmation_number,
                                 mt.robot_confirmation_number,
                                 mt.submitted_confirmation, '')), '') AS claim_number,
           br.status_check_next_at,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY br.status_check_next_at NULLS FIRST, br.created_at
           ) AS rn
    FROM public.billing_records br
    JOIN public.medicaid_trips mt ON mt.id = br.trip_id
    WHERE (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
      AND (
        (_record_ids IS NOT NULL AND br.id = ANY(_record_ids))
        OR (
          _record_ids IS NULL
          AND br.status IN ('submitted', 'approved', 'suspended')
          AND br.status_check_next_at IS NOT NULL
          AND br.status_check_next_at <= now()
        )
      )
  ),
  picked AS (
    SELECT d.* FROM due d
    WHERE d.claim_number IS NOT NULL
      AND d.rn <= pc
    -- Round-robin across companies FIRST: every company gets its 1st slot
    -- before any company gets its 2nd. A company with hundreds of due
    -- claims can never consume the whole global batch.
    ORDER BY d.rn, d.status_check_next_at NULLS FIRST
    LIMIT g
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => ls),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
      -- Re-checked under the row lock (EvalPlanQual): a tick that lost the
      -- race sees the winner's lease here and leases nothing for this row.
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lease_submission_jobs(_global_limit integer DEFAULT 20, _per_company_limit integer DEFAULT 4, _lease_seconds integer DEFAULT 300, _worker text DEFAULT NULL::text, _company_id uuid DEFAULT NULL::uuid, _stale_seconds integer DEFAULT 720, _record_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g  integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls integer := least(greatest(coalesce(_lease_seconds, 300), 30), 3600);
  st integer := least(greatest(coalesce(_stale_seconds, 720), 60), 7200);
  scope uuid := _company_id;
BEGIN
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'service_role' THEN
    IF auth.uid() IS NOT NULL THEN
      scope := public.current_user_company_id();
    END IF;
  END IF;

  RETURN QUERY
  WITH busy AS (
    -- Live portal sessions on an account ...
    SELECT coalesce(br.submit_account_key, br.company_id::text) AS akey
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
    UNION ALL
    -- ... plus rows another worker already holds a live lease on.
    SELECT coalesce(br.submit_account_key, br.company_id::text)
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND br.submit_locked_until IS NOT NULL
       AND br.submit_locked_until > now()
  ),
  active AS (SELECT akey, count(*)::int AS n FROM busy GROUP BY akey),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_account_key, br.company_id::text) AS akey,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           row_number() OVER (
             PARTITION BY coalesce(br.submit_account_key, br.company_id::text)
             ORDER BY coalesce(br.submit_next_attempt_at, br.updated_at), br.created_at
           ) AS rn
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
       AND (br.submit_next_attempt_at IS NULL OR br.submit_next_attempt_at <= now())
       AND (scope IS NULL OR br.company_id = scope)
       AND (_record_ids IS NULL OR br.id = ANY(_record_ids))
  ),
  picked AS (
    SELECT d.id, d.trip_id, d.company_id, d.attempt, d.rn
      FROM due d
      LEFT JOIN active a ON a.akey IS NOT DISTINCT FROM d.akey
     WHERE d.rn <= greatest(pc - coalesce(a.n, 0), 0)
     ORDER BY d.rn, d.akey, d.id
     LIMIT greatest(g - (SELECT n FROM total), 0)
  ),
  locked AS (
    UPDATE public.billing_records br
       SET submit_locked_until = now() + make_interval(secs => ls),
           submit_lease_started_at = now(),
           submit_heartbeat_at = now(),
           submit_worker = _worker
      FROM picked p
     WHERE br.id = p.id
       AND br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
     RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.attempt
    FROM picked p JOIN locked l ON l.id = p.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_admin_driver_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  drv_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    INTO drv_name
    FROM public.profiles p
   WHERE p.id = NEW.user_id;
  IF drv_name IS NULL OR drv_name = '' THEN drv_name := 'Driver'; END IF;

  INSERT INTO public.admin_notifications (kind, title, body, url, data)
  VALUES (
    'driver_status',
    drv_name || ' is now ' || replace(NEW.status::text, '_', ' '),
    'Driver status changed from ' || COALESCE(OLD.status::text, 'unknown') || ' → ' || NEW.status::text,
    '/drivers',
    jsonb_build_object('driver_id', NEW.id, 'status', NEW.status::text)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_admin_new_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  full_name text;
BEGIN
  full_name := trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''));
  IF full_name = '' THEN full_name := coalesce(NEW.email, 'Someone'); END IF;

  INSERT INTO public.admin_notifications (kind, title, body, url, data)
  VALUES (
    'signup',
    'New passenger signed up',
    full_name || COALESCE(' (' || NEW.email || ')', ''),
    '/passengers',
    jsonb_build_object('profile_id', NEW.id)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.owner_unscoped()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_platform_owner() AND public.current_user_company_id() IS NULL
$function$;

CREATE OR REPLACE FUNCTION public.portal_credential_fingerprint(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, login_email text, password_len integer, password_last4 text, password_fingerprint text, live_fingerprint text, matches boolean, password_updated_at timestamp with time zone, last_used_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _company UUID;
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;
  _company := COALESCE(_company_id, public.current_user_company_id());
  IF _company IS DISTINCT FROM public.current_user_company_id()
     AND public.current_user_company_id() IS NOT NULL THEN
    RAISE EXCEPTION 'cannot inspect another company''s credentials';
  END IF;

  RETURN QUERY
  SELECT c.portal_id,
         c.login_email,
         length(s.decrypted_secret)::int,
         c.password_last4,
         c.password_fingerprint,
         left(encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'),16),
         (c.password_fingerprint IS NOT NULL
           AND c.password_fingerprint = left(encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'),16)),
         c.password_updated_at,
         c.last_used_at
    FROM public.state_portal_credentials c
    LEFT JOIN vault.decrypted_secrets s ON s.id = c.password_secret_id
   WHERE c.portal_id = _portal_id AND c.company_id = _company
   LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_submitted_billing_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.state_confirmation_number IS NOT NULL THEN
    NEW.state_confirmation_number := COALESCE(NEW.state_confirmation_number, OLD.state_confirmation_number);
    -- Allow billing staff to record the real portal outcome; otherwise keep it submitted.
    IF NEW.status IS NULL OR NEW.status NOT IN ('submitted','paid','suspended','rejected','denied','approved') THEN
      NEW.status := 'submitted';
    END IF;
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    NEW.submission_error := NULL;
    NEW.fix_notes := NULL;
    NEW.requires_human_step := false;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_submitted_claims()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(OLD.submitted_confirmation, OLD.robot_confirmation_number) IS NOT NULL THEN
    NEW.submitted_confirmation := COALESCE(NEW.submitted_confirmation, OLD.submitted_confirmation);
    NEW.robot_confirmation_number := COALESCE(NEW.robot_confirmation_number, OLD.robot_confirmation_number);
    NEW.portal_confirmation := COALESCE(NEW.portal_confirmation, OLD.portal_confirmation);
    NEW.status := 'submitted';
    NEW.portal_status := 'submitted';
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    IF NEW.robot_last_status IS DISTINCT FROM 'SUBMITTED' THEN
      NEW.robot_last_status := 'SUBMITTED';
      NEW.robot_last_message := 'Claim already exists at the portal (confirmation #'
        || COALESCE(NEW.submitted_confirmation, NEW.robot_confirmation_number) || ').';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_robot_worker_health(_id text, _base_url text, _ok boolean, _error text DEFAULT NULL::text, _cooldown_seconds integer DEFAULT 120)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.robot_workers (id, base_url)
  VALUES (_id, _base_url)
  ON CONFLICT (id) DO NOTHING;

  IF _ok THEN
    UPDATE public.robot_workers
       SET last_health_ok_at = now(),
           last_health_error = NULL,
           failure_streak = 0,
           unhealthy_until = NULL,
           updated_at = now()
     WHERE id = _id;
  ELSE
    UPDATE public.robot_workers
       SET failure_streak = failure_streak + 1,
           last_health_error = left(coalesce(_error, 'unknown error'), 500),
           unhealthy_until = now() + make_interval(secs => greatest(30, least(3600, _cooldown_seconds))),
           updated_at = now()
     WHERE id = _id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_driver_on_trip_end()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('completed', 'cancelled')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers
       SET status = 'available'
     WHERE id = NEW.driver_id
       AND status = 'busy';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_stale_claim_status_locks(_grace_seconds integer DEFAULT 300)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.billing_records
  SET status_check_locked_until = NULL,
      status_check_worker = NULL
  WHERE status_check_locked_until IS NOT NULL
    AND status_check_locked_until < now() - make_interval(secs => greatest(coalesce(_grace_seconds, 300), 60));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_stale_submission_locks(_grace_seconds integer DEFAULT 300)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.billing_records
     SET submit_locked_until = NULL,
         submit_worker = NULL
   WHERE submit_locked_until IS NOT NULL
     AND submit_locked_until < now() - make_interval(secs => greatest(coalesce(_grace_seconds, 300), 60))
     AND status = 'queued';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requests_on_route(_ids uuid[])
 RETURNS TABLE(request_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT rs.request_id
    FROM public.route_stops rs
   WHERE rs.request_id = ANY(_ids)
$function$;

CREATE OR REPLACE FUNCTION public.riders_force_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_default_billing_portal(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _company UUID;
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  _company := COALESCE(_company_id, public.current_user_company_id());

  INSERT INTO public.billing_settings (company_id, default_portal_id)
  VALUES (_company, _portal_id)
  ON CONFLICT (company_id) DO UPDATE
    SET default_portal_id = EXCLUDED.default_portal_id,
        updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_passenger_ssn(_passenger_id uuid, _ssn text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _owner UUID;
  _digits TEXT;
  _sid UUID;
BEGIN
  _digits := regexp_replace(COALESCE(_ssn, ''), '\D', '', 'g');
  IF length(_digits) <> 9 THEN
    RAISE EXCEPTION 'SSN must be exactly 9 digits';
  END IF;

  SELECT user_id INTO _owner FROM public.passengers WHERE id = _passenger_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'passenger not found';
  END IF;

  IF _owner IS DISTINCT FROM auth.uid()
     AND NOT public.current_user_has_role('admin')
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  _sid := vault.create_secret(
    _digits,
    'passenger_ssn_' || _passenger_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Passenger SSN (encrypted)'
  );

  UPDATE public.passengers
     SET ssn_secret_id = _sid,
         ssn_last4 = right(_digits, 4),
         updated_at = now()
   WHERE id = _passenger_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_rider_ssn(_rider_id uuid, _ssn text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _digits TEXT;
  _sid UUID;
  _creator UUID;
BEGIN
  _digits := regexp_replace(COALESCE(_ssn, ''), '\D', '', 'g');
  IF length(_digits) <> 9 THEN
    RAISE EXCEPTION 'SSN must be exactly 9 digits';
  END IF;

  SELECT created_by INTO _creator FROM public.riders WHERE id = _rider_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rider not found';
  END IF;

  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role'
     AND NOT public.current_user_has_role('admin')
     AND NOT public.current_user_is_dispatch()
     AND (_creator IS NULL OR _creator IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  _sid := vault.create_secret(
    _digits,
    'rider_ssn_' || _rider_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Rider SSN (encrypted)'
  );

  UPDATE public.riders
     SET ssn_secret_id = _sid,
         last_4_ssn = right(_digits, 4),
         updated_at = now()
   WHERE id = _rider_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_company_from_driver()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.drivers WHERE id = NEW.driver_id;
  END IF;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_user_company_id();
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.stamp_company_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_user_company_id();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_dispatch_event_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := COALESCE(
      public.company_of_ride_request(NEW.request_id),
      public.company_of_trip(NEW.trip_id),
      public.company_of_route(NEW.route_id),
      public.company_of_driver(NEW.driver_id),
      current_user_company_id()
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_driver_trip_draft()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.driver_id IS NULL THEN
    NEW.driver_id := auth.uid();
  END IF;
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.profiles WHERE id = NEW.driver_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_medicaid_trip_creator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.driver_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_trip_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _driver_user UUID;
  _passenger_user UUID;
BEGIN
  IF NEW.status = 'in_progress' AND (OLD.status IS DISTINCT FROM 'in_progress') THEN
    SELECT user_id INTO _driver_user FROM public.drivers WHERE id = NEW.driver_id;
    SELECT user_id INTO _passenger_user FROM public.passengers WHERE id = NEW.passenger_id;
    IF _driver_user IS NOT NULL AND _passenger_user IS NOT NULL THEN
      INSERT INTO public.chat_conversations
        (kind, driver_user_id, passenger_user_id, trip_id, is_closed)
      VALUES ('driver_passenger', _driver_user, _passenger_user, NEW.id, false)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF NEW.status IN ('completed','cancelled') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.chat_conversations
       SET is_closed = true
     WHERE trip_id = NEW.id AND kind = 'driver_passenger';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_driver_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.passenger_rating IS NOT NULL AND (OLD.passenger_rating IS NULL OR OLD.passenger_rating <> NEW.passenger_rating) THEN
    UPDATE public.drivers d
    SET
      total_ratings = (SELECT COUNT(*) FROM public.trips WHERE driver_id = NEW.driver_id AND passenger_rating IS NOT NULL),
      rating = COALESCE((SELECT AVG(passenger_rating)::NUMERIC(3,2) FROM public.trips WHERE driver_id = NEW.driver_id AND passenger_rating IS NOT NULL), 0)
    WHERE d.id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_portal_credential(_portal_id text, _portal_name text, _state text, _login_email text, _login_password text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
  _company UUID;
  _pw TEXT := COALESCE(_login_password, '');
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  _company := COALESCE(_company_id, public.current_user_company_id());
  IF _company IS DISTINCT FROM public.current_user_company_id()
     AND public.current_user_company_id() IS NOT NULL THEN
    RAISE EXCEPTION 'cannot manage another company''s credentials';
  END IF;

  SELECT id INTO _existing_id
    FROM public.state_portal_credentials
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company, '00000000-0000-0000-0000-000000000000'::uuid);

  -- Blank password on an existing row = "keep the saved password".
  IF btrim(_pw) = '' THEN
    IF _existing_id IS NULL THEN
      RAISE EXCEPTION 'password is required when saving a new portal login';
    END IF;
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name, state = _state, login_email = btrim(_login_email)
     WHERE id = _existing_id;
    RETURN _existing_id;
  END IF;

  -- Invisible edge whitespace is the classic paste bug: strip it, always.
  _pw := btrim(_pw, E' \t\r\n');
  IF _pw = '' THEN
    RAISE EXCEPTION 'password cannot be blank';
  END IF;

  _last4 := right(_pw, 4);

  _new_secret_id := vault.create_secret(
    _pw,
    'portal_' || _portal_id || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_id, portal_name, state, login_email, password_secret_id, password_last4, company_id,
       password_len, password_fingerprint, password_updated_at)
    VALUES
      (_portal_id, _portal_name, _state, btrim(_login_email), _new_secret_id, _last4, _company,
       length(_pw), left(encode(sha256(convert_to(_pw,'UTF8')),'hex'),16), now())
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name,
           state = _state,
           login_email = btrim(_login_email),
           password_secret_id = _new_secret_id,
           password_last4 = _last4,
           password_len = length(_pw),
           password_fingerprint = left(encode(sha256(convert_to(_pw,'UTF8')),'hex'),16),
           password_updated_at = now()
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$function$;
