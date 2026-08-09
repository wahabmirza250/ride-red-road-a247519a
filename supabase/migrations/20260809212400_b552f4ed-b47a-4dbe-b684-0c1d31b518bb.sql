DROP POLICY IF EXISTS tenant_isolation ON public.user_roles;
CREATE POLICY tenant_isolation ON public.user_roles AS RESTRICTIVE FOR ALL TO public
USING (public.owner_unscoped() OR company_id = public.current_user_company_id() OR user_id = auth.uid())
WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id() OR user_id = auth.uid());