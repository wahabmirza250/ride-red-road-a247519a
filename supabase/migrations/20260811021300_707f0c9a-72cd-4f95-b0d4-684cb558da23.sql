-- 1) Stamp company on insert so credentials are never orphaned
DROP TRIGGER IF EXISTS state_portal_credentials_stamp_company ON public.state_portal_credentials;
CREATE TRIGGER state_portal_credentials_stamp_company
BEFORE INSERT ON public.state_portal_credentials
FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_portal_credentials TO authenticated;
GRANT ALL ON public.state_portal_credentials TO service_role;

-- 2) Default the company to the caller's own company in the upsert RPC
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

  _last4 := right(_login_password, 4);

  _new_secret_id := vault.create_secret(
    _login_password,
    'portal_' || _portal_id || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_id, portal_name, state, login_email, password_secret_id, password_last4, company_id)
    VALUES
      (_portal_id, _portal_name, _state, _login_email, _new_secret_id, _last4, _company)
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name,
           state = _state,
           login_email = _login_email,
           password_secret_id = _new_secret_id,
           password_last4 = _last4
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$function$;

-- 3) Same defaulting for the billing default-portal setting
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

-- 4) Re-home the orphaned credential row to Walla Investment LLC
UPDATE public.state_portal_credentials
   SET company_id = '11111111-2222-4333-8444-555555555555'
 WHERE company_id IS NULL;

-- 5) Same for any orphaned billing settings row
UPDATE public.billing_settings
   SET company_id = '11111111-2222-4333-8444-555555555555'
 WHERE company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.billing_settings b2
      WHERE b2.company_id = '11111111-2222-4333-8444-555555555555'
   );
DELETE FROM public.billing_settings WHERE company_id IS NULL;