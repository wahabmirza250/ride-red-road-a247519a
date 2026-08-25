DROP POLICY IF EXISTS "Admins manage their company driver pay plans" ON public.driver_pay_plans;
CREATE POLICY "Admins manage their company driver pay plans"
ON public.driver_pay_plans
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
);

DROP POLICY IF EXISTS "Admins manage their company payout items" ON public.driver_payout_items;
CREATE POLICY "Admins manage their company payout items"
ON public.driver_payout_items
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
);