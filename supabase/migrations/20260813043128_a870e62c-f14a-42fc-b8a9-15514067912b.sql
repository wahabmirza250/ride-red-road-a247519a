DROP POLICY IF EXISTS tenant_isolation ON public.medicaid_trip_legs;
CREATE POLICY tenant_isolation ON public.medicaid_trip_legs
AS RESTRICTIVE
FOR ALL
USING (
  public.owner_unscoped() OR EXISTS (
    SELECT 1 FROM public.medicaid_trips t
    WHERE t.id = medicaid_trip_legs.medicaid_trip_id
      AND t.company_id = public.current_user_company_id()
  )
)
WITH CHECK (
  public.owner_unscoped() OR EXISTS (
    SELECT 1 FROM public.medicaid_trips t
    WHERE t.id = medicaid_trip_legs.medicaid_trip_id
      AND t.company_id = public.current_user_company_id()
  )
);