CREATE OR REPLACE FUNCTION public.owner_unscoped()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_owner() AND public.current_user_company_id() IS NULL
$$;

REVOKE ALL ON FUNCTION public.owner_unscoped() FROM public;
GRANT EXECUTE ON FUNCTION public.owner_unscoped() TO authenticated, service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_rate_settings','billing_records','driver_shifts','drivers','gas_receipts','medicaid_trips','passengers','ride_requests','riders','routes','state_portal_credentials','trips','user_roles']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public USING (public.owner_unscoped() OR company_id = public.current_user_company_id()) WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id())',
      t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON public.profiles;
CREATE POLICY tenant_isolation ON public.profiles AS RESTRICTIVE FOR ALL TO public
USING (public.owner_unscoped() OR company_id = public.current_user_company_id() OR id = auth.uid())
WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id() OR id = auth.uid());