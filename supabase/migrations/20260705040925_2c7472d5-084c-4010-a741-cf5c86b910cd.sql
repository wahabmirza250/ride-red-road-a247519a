
-- 1. Extend state_portal_credentials
ALTER TABLE public.state_portal_credentials
  ADD COLUMN IF NOT EXISTS portal_id TEXT,
  ADD COLUMN IF NOT EXISTS company_id UUID;

-- Backfill portal_id for any existing rows so we can require it going forward
UPDATE public.state_portal_credentials
   SET portal_id = lower(regexp_replace(portal_name, '\s+', '-', 'g')) || '-' || lower(state)
 WHERE portal_id IS NULL;

ALTER TABLE public.state_portal_credentials
  ALTER COLUMN portal_id SET NOT NULL;

-- Drop old uniqueness on (portal_name, state) if present, add new on (portal_id, company_id)
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.state_portal_credentials'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE 'ALTER TABLE public.state_portal_credentials DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS state_portal_credentials_portal_company_uidx
  ON public.state_portal_credentials (portal_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2. billing_records.requires_human_step
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS requires_human_step BOOLEAN NOT NULL DEFAULT false;

-- 3. billing_settings singleton
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID UNIQUE,
  default_portal_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read billing settings" ON public.billing_settings;
CREATE POLICY "admins read billing settings"
  ON public.billing_settings FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('admin'));

-- Ensure a single default row exists (company_id NULL for now = "this workspace")
INSERT INTO public.billing_settings (company_id, default_portal_id)
SELECT NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.billing_settings WHERE company_id IS NULL);

DROP TRIGGER IF EXISTS billing_settings_set_updated_at ON public.billing_settings;
CREATE TRIGGER billing_settings_set_updated_at
  BEFORE UPDATE ON public.billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Updated upsert function — includes portal_id + company_id
CREATE OR REPLACE FUNCTION public.upsert_portal_credential(
  _portal_id TEXT,
  _portal_name TEXT,
  _state TEXT,
  _login_email TEXT,
  _login_password TEXT,
  _company_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'admin only';
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

-- 5. Fetch decrypted portal credentials — service-role only (called from edge fn)
CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(
  _portal_id TEXT,
  _company_id UUID DEFAULT NULL
)
RETURNS TABLE(portal_id TEXT, portal_name TEXT, state TEXT, login_email TEXT, login_password TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  RETURN QUERY
  SELECT c.portal_id,
         c.portal_name,
         c.state,
         c.login_email,
         (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = c.password_secret_id) AS login_password
    FROM public.state_portal_credentials c
   WHERE c.portal_id = _portal_id
     AND COALESCE(c.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  UPDATE public.state_portal_credentials
     SET last_used_at = now()
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_credential_for_submission(TEXT, UUID) TO service_role;

-- 6. Set default portal (admin)
CREATE OR REPLACE FUNCTION public.set_default_billing_portal(_portal_id TEXT, _company_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  INSERT INTO public.billing_settings (company_id, default_portal_id)
  VALUES (_company_id, _portal_id)
  ON CONFLICT (company_id) DO UPDATE
    SET default_portal_id = EXCLUDED.default_portal_id,
        updated_at = now();
END;
$function$;
