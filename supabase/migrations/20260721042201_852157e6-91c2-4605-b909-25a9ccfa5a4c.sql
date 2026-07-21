-- Encrypted SSN references (values live in Supabase Vault, not in these tables)
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS ssn_secret_id UUID;
ALTER TABLE public.riders     ADD COLUMN IF NOT EXISTS ssn_secret_id UUID;

-- ------------------------------------------------------------------
-- Passenger-owned SSN: the signed-in passenger (or an admin) may set it.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_passenger_ssn(_passenger_id UUID, _ssn TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_passenger_ssn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_passenger_ssn(uuid, text) TO authenticated;

-- ------------------------------------------------------------------
-- Rider-owned SSN: any signed-in user who can access the rider row per RLS
-- may attach an SSN. The rider check runs against the RLS-visible row.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_rider_ssn(_rider_id UUID, _ssn TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _digits TEXT;
  _sid UUID;
BEGIN
  _digits := regexp_replace(COALESCE(_ssn, ''), '\D', '', 'g');
  IF length(_digits) <> 9 THEN
    RAISE EXCEPTION 'SSN must be exactly 9 digits';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.riders WHERE id = _rider_id) THEN
    RAISE EXCEPTION 'rider not found';
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
$$;

REVOKE ALL ON FUNCTION public.set_rider_ssn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_rider_ssn(uuid, text) TO authenticated;

-- ------------------------------------------------------------------
-- Transfer a passenger's SSN secret onto a rider row (used when the
-- driver materializes a rider from a passenger-app row at pickup).
-- Restricted to authenticated users; the SSN never enters the client.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_passenger_ssn_to_rider(_passenger_id UUID, _rider_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------
-- Decrypt helpers — ADMIN OR SERVICE ROLE ONLY. Used server-side to
-- fill the "Member Health First Colorado ID #" field on the state PDF
-- when the passenger has no Medicaid ID on file.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_decrypted_passenger_ssn(_passenger_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_decrypted_passenger_ssn(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.get_decrypted_rider_ssn(_rider_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_decrypted_rider_ssn(uuid) FROM PUBLIC, authenticated;