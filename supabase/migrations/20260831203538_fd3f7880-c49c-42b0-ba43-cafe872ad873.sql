-- Fail-closed replacement: the previous version validated the SELECTED provider
-- but not the CALLER, so any authenticated user could set another company's
-- billing provider by calling the RPC with known UUIDs.
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
  _caller uuid := auth.uid();
  _caller_company uuid;
  _ok boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF _company_id IS NULL OR _provider_id IS NULL THEN
    RAISE EXCEPTION 'Company and provider are required';
  END IF;

  -- The caller may only ever act on their OWN company.
  _caller_company := public.current_user_company_id();
  IF _caller_company IS NULL OR _caller_company <> _company_id THEN
    RAISE EXCEPTION 'Not allowed to change billing settings for that company';
  END IF;

  IF NOT (
    public.current_user_has_role('admin'::app_role)
    OR public.current_user_can_bill()
  ) THEN
    RAISE EXCEPTION 'Only admins and billing staff can set the billing provider';
  END IF;

  -- The selected person must be an active member of the SAME company whose
  -- qualifying role is also scoped to that company (no cross-company role,
  -- no null-company role: only platform_owner uses that convention here).
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.id
     AND ur.company_id = _company_id
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

REVOKE ALL ON FUNCTION public.set_default_billing_provider(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_default_billing_provider(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.set_default_billing_provider(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.set_default_billing_provider(uuid, uuid) TO authenticated;