-- 1. Track who created each Medicaid trip / paper bill
ALTER TABLE public.medicaid_trips ADD COLUMN IF NOT EXISTS created_by uuid;
UPDATE public.medicaid_trips SET created_by = driver_id WHERE created_by IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_medicaid_trip_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.driver_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_medicaid_trip_creator() FROM anon, authenticated;

DROP TRIGGER IF EXISTS stamp_medicaid_trip_creator ON public.medicaid_trips;
CREATE TRIGGER stamp_medicaid_trip_creator
BEFORE INSERT ON public.medicaid_trips
FOR EACH ROW EXECUTE FUNCTION public.stamp_medicaid_trip_creator();

CREATE INDEX IF NOT EXISTS medicaid_trips_created_by_idx ON public.medicaid_trips (created_by);

-- 2. Role helpers
CREATE OR REPLACE FUNCTION public.current_user_can_bill()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','billing','admin_biller')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_sees_all_bills()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','admin_biller','platform_owner')
  )
$$;
GRANT EXECUTE ON FUNCTION public.current_user_sees_all_bills() TO authenticated, service_role;

-- 3. Scope plain billers to their own entries
DROP POLICY IF EXISTS "medicaid_trips billing read" ON public.medicaid_trips;
CREATE POLICY "medicaid_trips billing read" ON public.medicaid_trips
FOR SELECT TO authenticated
USING (
  public.current_user_can_bill()
  AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "medicaid_trips billing update" ON public.medicaid_trips;
CREATE POLICY "medicaid_trips billing update" ON public.medicaid_trips
FOR UPDATE TO authenticated
USING (
  public.current_user_can_bill()
  AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
)
WITH CHECK (
  public.current_user_can_bill()
  AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "billing_records billing staff all" ON public.billing_records;
CREATE POLICY "billing_records billing staff all" ON public.billing_records
FOR ALL TO authenticated
USING (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
)
WITH CHECK (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "medicaid_trip_legs billing all" ON public.medicaid_trip_legs;
CREATE POLICY "medicaid_trip_legs billing all" ON public.medicaid_trip_legs
FOR ALL TO authenticated
USING (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR medicaid_trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
)
WITH CHECK (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR medicaid_trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
);

-- 4. Let admins manage the new role
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF _role::text = 'platform_owner'
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'platform_owner may only be granted directly by the platform';
  END IF;
  IF current_setting('role', true) = 'service_role' OR session_user = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF _role::text IN ('driver','dispatch','admin','billing','admin_biller') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;