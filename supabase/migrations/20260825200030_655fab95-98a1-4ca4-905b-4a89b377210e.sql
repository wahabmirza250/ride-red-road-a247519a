DROP POLICY IF EXISTS "tenant_isolation" ON public.driver_pay;
DROP POLICY IF EXISTS "driver_pay admin only" ON public.driver_pay;
CREATE POLICY "Admins manage company driver pay"
ON public.driver_pay
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
);

DROP POLICY IF EXISTS "tenant_isolation" ON public.driver_payouts;
DROP POLICY IF EXISTS "Admins manage driver payouts" ON public.driver_payouts;
CREATE POLICY "Admins manage company driver payouts"
ON public.driver_payouts
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
);

DROP POLICY IF EXISTS "tenant_isolation" ON public.driver_hour_clearings;
DROP POLICY IF EXISTS "Admins manage hour clearings" ON public.driver_hour_clearings;
CREATE POLICY "Admins manage company hour clearings"
ON public.driver_hour_clearings
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
);