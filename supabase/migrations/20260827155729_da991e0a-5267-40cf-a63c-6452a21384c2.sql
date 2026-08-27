CREATE POLICY "tenant_isolation" ON public.billing_settings
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.owner_unscoped() OR company_id = public.current_user_company_id())
WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id());