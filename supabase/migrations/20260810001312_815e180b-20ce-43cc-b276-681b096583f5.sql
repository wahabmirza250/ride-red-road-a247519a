-- Portal credentials: billing staff get full control (company-scoped by the
-- existing tenant_isolation policy).
CREATE POLICY "portal_credentials billing all"
  ON public.state_portal_credentials
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- Rate settings: billing staff can manage, not just read.
CREATE POLICY "billing_rate_settings billing manage"
  ON public.billing_rate_settings
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- Default portal + credential RPCs: allow billing role in addition to admin.
CREATE OR REPLACE FUNCTION public.set_default_billing_portal(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  INSERT INTO public.billing_settings (company_id, default_portal_id)
  VALUES (_company_id, _portal_id)
  ON CONFLICT (company_id) DO UPDATE
    SET default_portal_id = EXCLUDED.default_portal_id,
        updated_at = now();
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
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  SELECT id INTO _existing_id
    FROM public.state_portal_credentials
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid);

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
      (_portal_id, _portal_name, _state, _login_email, _new_secret_id, _last4, _company_id)
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