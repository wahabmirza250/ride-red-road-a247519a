-- 1. Verification metadata for saved portal logins (one-way; never the password)
ALTER TABLE public.state_portal_credentials
  ADD COLUMN IF NOT EXISTS password_len integer,
  ADD COLUMN IF NOT EXISTS password_fingerprint text,
  ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;

-- Backfill from the vault secret each row currently points at.
UPDATE public.state_portal_credentials c
   SET password_len = length(s.decrypted_secret),
       password_fingerprint = left(encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'), 16),
       password_updated_at = COALESCE(c.password_updated_at, s.created_at)
  FROM vault.decrypted_secrets s
 WHERE s.id = c.password_secret_id
   AND c.password_fingerprint IS NULL;

-- 2. Hardened upsert: blank password keeps the existing secret, never wipes it.
CREATE OR REPLACE FUNCTION public.upsert_portal_credential(
  _portal_id text, _portal_name text, _state text,
  _login_email text, _login_password text, _company_id uuid DEFAULT NULL::uuid)
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

-- 3. Retrieval now also reports one-way verification data so callers can prove
--    the decrypted secret is exactly the one that was saved.
DROP FUNCTION IF EXISTS public.get_portal_credential_for_submission(text, uuid);
CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, portal_name text, state text, login_email text, login_password text,
               password_len integer, password_fingerprint text, stored_fingerprint text,
               fingerprint_matches boolean, password_updated_at timestamptz)
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

-- 4. Biller-facing diagnostic: proves what is stored without revealing it.
CREATE OR REPLACE FUNCTION public.portal_credential_fingerprint(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, login_email text, password_len integer, password_last4 text,
               password_fingerprint text, live_fingerprint text, matches boolean,
               password_updated_at timestamptz, last_used_at timestamptz)
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

GRANT EXECUTE ON FUNCTION public.portal_credential_fingerprint(text, uuid) TO authenticated;