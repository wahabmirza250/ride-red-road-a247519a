-- 1. Harden set_rider_ssn: it previously had no caller authorization check.
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

-- 2. Drop the stale 4-argument portal credential overload (ambiguous signature).
DROP FUNCTION IF EXISTS public.upsert_portal_credential(text, text, text, text);

-- 3. Remove anonymous / unnecessary EXECUTE on sensitive + trigger-only functions.
REVOKE ALL ON FUNCTION public.get_decrypted_passenger_ssn(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_rider_ssn(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_passenger_ssn(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_rider_ssn(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_trip_driver_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_user_roles_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_driver_on_trip_end() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_is_dispatch() FROM PUBLIC, anon;

-- 4. Keep the signed-in paths the app actually uses working.
GRANT EXECUTE ON FUNCTION public.set_passenger_ssn(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_rider_ssn(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_dispatch() TO authenticated;

-- 5. Server-side (service role) callers need explicit EXECUTE.
GRANT EXECUTE ON FUNCTION public.get_decrypted_passenger_ssn(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_rider_ssn(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_portal_credential_for_submission(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_passenger_ssn(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_rider_ssn(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(text, text, text, text, text, uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_billing_portal(text, uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_can_see_passenger(uuid) TO service_role;