CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, portal_name text, state text, login_email text, login_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  -- Fail closed: a portal login is company-owned. No default / NULL-company
  -- fallback, and never another company's credential.
  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required: portal logins are never shared between companies';
  END IF;

  RETURN QUERY
  SELECT credential.portal_id,
         credential.portal_name,
         credential.state,
         credential.login_email,
         decrypted.decrypted_secret AS login_password
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