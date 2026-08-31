ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS default_provider_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- One settings row per company (idempotent; a unique index already exists).
CREATE UNIQUE INDEX IF NOT EXISTS billing_settings_company_uniq2
  ON public.billing_settings (company_id);

GRANT SELECT, INSERT, UPDATE ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;

DROP POLICY IF EXISTS "billing_settings admin insert" ON public.billing_settings;
CREATE POLICY "billing_settings admin insert"
  ON public.billing_settings FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (public.current_user_has_role('admin'::app_role) OR public.current_user_can_bill())
  );

DROP POLICY IF EXISTS "billing_settings admin update" ON public.billing_settings;
CREATE POLICY "billing_settings admin update"
  ON public.billing_settings FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (public.current_user_has_role('admin'::app_role) OR public.current_user_can_bill())
  )
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (public.current_user_has_role('admin'::app_role) OR public.current_user_can_bill())
  );

CREATE OR REPLACE FUNCTION public.set_default_billing_provider(
  _provider_id uuid,
  _company_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok boolean;
BEGIN
  IF _company_id IS NULL OR _provider_id IS NULL THEN
    RAISE EXCEPTION 'Company and provider are required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = _provider_id
      AND p.company_id = _company_id
      AND COALESCE(p.is_active, true)
      AND ur.role IN ('admin'::app_role, 'billing'::app_role, 'admin_biller'::app_role)
  ) INTO _ok;

  IF NOT _ok THEN
    RAISE EXCEPTION 'That person is not an active admin or billing user in this company';
  END IF;

  INSERT INTO public.billing_settings (company_id, default_provider_id)
  VALUES (_company_id, _provider_id)
  ON CONFLICT (company_id)
  DO UPDATE SET default_provider_id = EXCLUDED.default_provider_id,
                updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_default_billing_provider(uuid, uuid) TO authenticated, service_role;